import {
  type AIProvider,
  type AIRequest,
  type AISurface,
  type AIUsage,
  DISABLED_PROVIDER_NAME,
  detectInjection,
  isAIError,
  neutralizeDelimiters,
  untrusted,
} from '@jave/ai';
import type { ServiceContext } from '../kernel/context';
import { sha256Hex } from '../kernel/crypto';
import { DisabledError, ExternalServiceError, ValidationError } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { authorize, requireUser } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { getSettings } from '../settings/settings.service';
import {
  AI_BURST_LIMIT,
  AI_BURST_WINDOW_SECONDS,
  type AiFeature,
  EMPTY_RESPONSE_CODE,
  FEATURE_MAX_TOKENS,
  MAX_OUTPUT_CHARS,
  UNEXPECTED_ERROR_CODE,
} from './constants';
import { finalizeRequest, type LedgerEntry, recordDenied, reserveRequest } from './ledger';
import { FEATURE_INSTRUCTIONS, JAVE_SYSTEM_PROMPT } from './prompts';
import { redactForAI } from './redaction';

/**
 * Process-level AI dependencies, built once by the surface (bot, dashboard)
 * from the environment: `{ provider: createProviderFromEnv(env),
 * dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT }`.
 */
export interface AiDeps {
  provider: AIProvider;
  /** Deployment ceiling; the effective daily limit is min(settings, ceiling). */
  dailyRequestCeiling?: number;
}

export type AiWarning = 'input_redacted' | 'possible_prompt_injection' | 'output_truncated';

export interface UntrustedInput {
  label: string;
  text: string;
}

export interface CompletionSpec {
  feature: AiFeature;
  surface: AISurface;
  /** The member's own request (their question or topic). */
  request?: string;
  /** Pasted or Discord content, wrapped as untrusted data. */
  data?: readonly UntrustedInput[];
}

export interface CompletionResult {
  text: string;
  aiRequestId: string;
  model: string;
  provider: string;
  usage: AIUsage;
  latencyMs: number;
  /** The model hit its token budget or the output was cut to MAX_OUTPUT_CHARS. */
  truncated: boolean;
  warnings: AiWarning[];
}

const AI_SERVICE = 'ai';

/** Provider failure → calm, user-safe error. Unexpected errors propagate unchanged. */
function toServiceError(ctx: ServiceContext, error: unknown): unknown {
  if (!isAIError(error)) return error;
  switch (error.kind) {
    case 'disabled':
      return new DisabledError('JAVE AI');
    case 'refusal':
      return new ExternalServiceError(AI_SERVICE, 'JAVE AI declined this request.', false);
    case 'rate_limited':
    case 'overloaded':
      return new ExternalServiceError(
        AI_SERVICE,
        'JAVE AI is at capacity. Try again in a minute.',
        true,
      );
    case 'timeout':
      return new ExternalServiceError(
        AI_SERVICE,
        'JAVE AI took too long to respond. Try again.',
        true,
      );
    case 'invalid_request':
      return new ExternalServiceError(AI_SERVICE, 'JAVE AI could not process that request.', false);
    case 'auth':
    case 'configuration':
      ctx.logger.error({ provider: error.provider, kind: error.kind }, 'AI provider misconfigured');
      return new ExternalServiceError(AI_SERVICE, 'JAVE AI is unavailable right now.', false);
    default:
      return new ExternalServiceError(
        AI_SERVICE,
        'JAVE AI is unavailable right now.',
        error.retryable,
      );
  }
}

/**
 * The member's own request is trusted as a request, but it still cannot
 * contain our data delimiters (so it cannot fake the end of a data block).
 */
function buildUserContent(
  feature: AiFeature,
  request: string | undefined,
  data: readonly UntrustedInput[],
): string {
  const parts = [FEATURE_INSTRUCTIONS[feature]];
  if (request) parts.push(`MEMBER REQUEST:\n${neutralizeDelimiters(request)}`);
  for (const input of data) parts.push(untrusted(input.label, input.text));
  return parts.join('\n\n');
}

/**
 * Stable fingerprint of what was asked (after redaction). The random data
 * boundary is excluded so identical requests hash identically, which is what
 * abuse investigation and dedupe need. Never the prompt itself.
 */
function promptFingerprint(
  feature: AiFeature,
  request: string | undefined,
  data: readonly UntrustedInput[],
): string {
  return sha256Hex(
    JSON.stringify([
      JAVE_SYSTEM_PROMPT,
      FEATURE_INSTRUCTIONS[feature],
      request ?? null,
      data.map((d) => [d.label, d.text]),
    ]),
  );
}

/**
 * The guarded path every AI feature takes: capability → burst limit →
 * enabled → input size → secret redaction → untrusted wrapping → daily-limit
 * reservation → provider call → ledger. Never runs inside a transaction.
 */
export async function runCompletion(
  ctx: ServiceContext,
  deps: AiDeps,
  spec: CompletionSpec,
): Promise<CompletionResult> {
  const actor = requireUser(ctx);
  await authorize(ctx, 'canUseAI', { type: 'ai', id: spec.feature });
  await consumeRateLimit(ctx, `ai:burst:${actor.userId}`, AI_BURST_LIMIT, AI_BURST_WINDOW_SECONDS);
  const settings = await getSettings(ctx, 'ai');
  const { provider } = deps;
  const entry: LedgerEntry = {
    userId: actor.userId,
    feature: spec.feature,
    surface: spec.surface,
    provider: provider.name,
    model: provider.defaultModel,
  };
  const dailyLimit = Math.min(
    settings.dailyRequestsPerUser,
    deps.dailyRequestCeiling ?? Number.POSITIVE_INFINITY,
  );
  if (!settings.enabled || provider.name === DISABLED_PROVIDER_NAME || dailyLimit <= 0) {
    await recordDenied(ctx, entry, 'disabled', 'disabled');
    throw new DisabledError('JAVE AI');
  }

  const data = spec.data ?? [];
  const inputChars = (spec.request?.length ?? 0) + data.reduce((n, d) => n + d.text.length, 0);
  if (inputChars === 0) throw new ValidationError('Nothing to send to JAVE AI.');
  if (inputChars > settings.maxInputChars) {
    throw new ValidationError(
      `Input is too long — ${settings.maxInputChars} characters max (got ${inputChars}).`,
    );
  }

  const warnings = new Set<AiWarning>();
  const redact = (text: string) => {
    const result = redactForAI(text);
    if (result.redacted) warnings.add('input_redacted');
    return result.text;
  };
  const request = spec.request === undefined ? undefined : redact(spec.request);
  const safeData = data.map((d) => ({ label: d.label, text: redact(d.text) }));
  const signals = [request ?? '', ...safeData.map((d) => d.text)].flatMap(
    (text) => detectInjection(text).signals,
  );
  if (signals.length > 0) {
    warnings.add('possible_prompt_injection');
    ctx.logger.warn(
      { feature: spec.feature, signals: [...new Set(signals)] },
      'possible prompt injection in AI input',
    );
  }

  const aiRequest: AIRequest = {
    system: JAVE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(spec.feature, request, safeData) }],
    maxTokens: FEATURE_MAX_TOKENS[spec.feature],
  };
  const promptHash = promptFingerprint(spec.feature, request, safeData);
  const reservation = await reserveRequest(ctx, { ...entry, promptHash }, dailyLimit);

  let response;
  try {
    response = await provider.complete(aiRequest, {
      context: { userId: actor.userId, feature: spec.feature, surface: spec.surface },
    });
  } catch (error) {
    await finalizeRequest(ctx, reservation.id, {
      status: isAIError(error) && error.kind === 'refusal' ? 'refused' : 'error',
      errorCode: isAIError(error) ? error.kind : UNEXPECTED_ERROR_CODE,
    });
    ctx.logger.warn(
      {
        feature: spec.feature,
        provider: provider.name,
        kind: isAIError(error) ? error.kind : UNEXPECTED_ERROR_CODE,
      },
      'AI request failed',
    );
    throw toServiceError(ctx, error);
  }

  const empty = response.text.trim() === '';
  await finalizeRequest(ctx, reservation.id, {
    status: empty ? 'error' : 'ok',
    model: response.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    latencyMs: response.latencyMs,
    errorCode: empty ? EMPTY_RESPONSE_CODE : undefined,
  });
  if (empty) {
    throw new ExternalServiceError(AI_SERVICE, 'JAVE AI returned an empty answer. Try again.');
  }
  const cut = response.text.length > MAX_OUTPUT_CHARS;
  if (cut || response.stopReason === 'max_tokens') warnings.add('output_truncated');
  return {
    text: cut ? truncate(response.text, MAX_OUTPUT_CHARS) : response.text,
    aiRequestId: reservation.id,
    model: response.model,
    provider: response.provider,
    usage: response.usage,
    latencyMs: response.latencyMs,
    truncated: cut || response.stopReason === 'max_tokens',
    warnings: [...warnings],
  };
}
