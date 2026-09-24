import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AIAbortedError,
  AIAuthError,
  type AIError,
  AIInvalidRequestError,
  AIMalformedResponseError,
  AIOverloadedError,
  AIRateLimitError,
  AIRefusalError,
  AITimeoutError,
  AIUnavailableError,
  errorForStatus,
  isAIError,
  OVERLOADED_STATUS,
} from '../errors';
import { createDeadline, type FetchLike } from '../http';
import { parseRetryAfterMs, type RetryPolicy, retryPolicy, withRetry } from '../retry';
import type {
  AICompleteOptions,
  AIHealth,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStopReason,
} from '../types';
import { DEFAULT_TIMEOUT_MS, elapsedMs, nonNegativeInt, validateRequest } from './shared';

/** Default model per the Claude API guidance; override with AI_MODEL. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const PROVIDER = 'anthropic';

/**
 * Server-side refusal fallbacks: on a safety-classifier decline the API
 * re-runs the request on Anthropic's recommended fallback model in the same
 * call. Only sent to the first-party API for models that support it.
 */
export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const REFUSAL_FALLBACK_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
]);

/**
 * Models that still accept `temperature`. Newer models reject sampling
 * parameters with a 400, so the parameter is dropped for anything not listed.
 */
const SAMPLING_MODEL_PREFIXES: readonly string[] = [
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-opus-4-0',
  'claude-sonnet-4-0',
  'claude-3',
];

/** Anthropic asks for an opaque, stable user id for abuse detection; never send the raw id. */
export function opaqueUserId(userId: string): string {
  return createHash('sha256').update(`jave-user:${userId}`).digest('hex');
}

export function acceptsSamplingParams(model: string): boolean {
  return SAMPLING_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

type MessageParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

/** The fields read from both `Message` and `BetaMessage`. */
interface ClaudeMessage {
  model: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  } | null;
}

interface PreparedRequest {
  params: MessageParams;
  /** Sent through the beta endpoint with server-side refusal fallbacks. */
  refusalFallback: boolean;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /**
   * 'auto' enables server-side refusal fallbacks on the first-party API for
   * models that support them; `false` never sends them.
   */
  refusalFallback?: 'auto' | false;
}

/**
 * Claude via the official Anthropic SDK (Messages API). The SDK's own retries
 * are disabled so every provider shares one retry policy; its fetch is
 * injectable so tests never touch the network.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = PROVIDER;
  readonly defaultModel: string;
  private readonly client: Anthropic;
  private readonly timeoutMs: number;
  private readonly policy: RetryPolicy;
  private readonly fallbackEligible: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.defaultModel = options.defaultModel ?? ANTHROPIC_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.policy = retryPolicy(options.retry);
    const baseURL = options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
    this.fallbackEligible =
      options.refusalFallback !== false &&
      baseURL.replace(/\/+$/, '') === ANTHROPIC_DEFAULT_BASE_URL;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      webhookKey: null,
      baseURL,
      fetch: options.fetch,
      maxRetries: 0,
      timeout: this.timeoutMs,
      logLevel: 'off',
    });
  }

  async complete(request: AIRequest, options: AICompleteOptions = {}): Promise<AIResponse> {
    const valid = validateRequest(request, PROVIDER);
    const prepared = this.prepare(valid, options);
    const started = performance.now();
    const message = await withRetry(
      () => this.send(prepared, options.signal),
      this.policy,
      options.signal,
    );
    return this.toResponse(message, started);
  }

  async health(): Promise<AIHealth> {
    const deadline = createDeadline(this.timeoutMs);
    try {
      const model = await this.client.models.retrieve(this.defaultModel, undefined, {
        signal: deadline.signal,
      });
      return { ok: true, detail: `model ${model.id} reachable` };
    } catch (error) {
      const mapped = this.mapError(error, deadline.timedOut());
      return { ok: false, detail: mapped.message };
    } finally {
      deadline.dispose();
    }
  }

  private prepare(request: AIRequest, options: AICompleteOptions): PreparedRequest {
    const model = request.model ?? this.defaultModel;
    return {
      refusalFallback: this.fallbackEligible && REFUSAL_FALLBACK_MODELS.has(model),
      params: {
        model,
        max_tokens: request.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(request.stop?.length ? { stop_sequences: [...request.stop] } : {}),
        ...(request.temperature !== undefined && acceptsSamplingParams(model)
          ? { temperature: request.temperature }
          : {}),
        ...(options.context ? { metadata: { user_id: opaqueUserId(options.context.userId) } } : {}),
      },
    };
  }

  private async send(prepared: PreparedRequest, signal?: AbortSignal): Promise<ClaudeMessage> {
    const deadline = createDeadline(this.timeoutMs, signal);
    const requestOptions = { signal: deadline.signal };
    try {
      return prepared.refusalFallback
        ? await this.client.beta.messages.create(
            { ...prepared.params, betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' },
            requestOptions,
          )
        : await this.client.messages.create(prepared.params, requestOptions);
    } catch (error) {
      throw this.mapError(error, deadline.timedOut());
    } finally {
      deadline.dispose();
    }
  }

  private toResponse(message: ClaudeMessage, started: number): AIResponse {
    if (!message || !Array.isArray(message.content)) {
      throw new AIMalformedResponseError({ provider: PROVIDER });
    }
    if (message.stop_reason === 'refusal') {
      throw new AIRefusalError({ provider: PROVIDER, category: message.stop_details?.category });
    }
    const text = message.content
      .flatMap((block) =>
        block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
      )
      .join('');
    const usage = message.usage;
    return {
      text,
      model: message.model,
      provider: PROVIDER,
      stopReason: mapStopReason(message.stop_reason),
      usage: {
        inputTokens:
          nonNegativeInt(usage?.input_tokens) +
          nonNegativeInt(usage?.cache_creation_input_tokens) +
          nonNegativeInt(usage?.cache_read_input_tokens),
        outputTokens: nonNegativeInt(usage?.output_tokens),
      },
      latencyMs: elapsedMs(started),
    };
  }

  /** SDK error → AIError. Uses the SDK's typed classes, most specific first. */
  private mapError(error: unknown, timedOut: boolean): AIError {
    if (isAIError(error)) return error;
    const base = { provider: PROVIDER };
    if (error instanceof Anthropic.APIUserAbortError) {
      return timedOut
        ? new AITimeoutError({ ...base, timeoutMs: this.timeoutMs })
        : new AIAbortedError(base);
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new AITimeoutError({ ...base, timeoutMs: this.timeoutMs });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return timedOut
        ? new AITimeoutError({ ...base, timeoutMs: this.timeoutMs })
        : new AIUnavailableError(base, 'connection failed');
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new AIRateLimitError({
        ...base,
        status: error.status,
        retryAfterMs: parseRetryAfterMs(error.headers),
        upstreamType: error.type ?? undefined,
      });
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return new AIAuthError({ ...base, status: error.status });
    }
    if (
      error instanceof Anthropic.BadRequestError ||
      error instanceof Anthropic.NotFoundError ||
      error instanceof Anthropic.UnprocessableEntityError
    ) {
      return new AIInvalidRequestError({
        ...base,
        status: error.status,
        upstreamType: error.type ?? undefined,
      });
    }
    if (error instanceof Anthropic.InternalServerError) {
      const overloaded = error.status === OVERLOADED_STATUS || error.type === 'overloaded_error';
      return overloaded
        ? new AIOverloadedError({ ...base, status: error.status, upstreamType: 'overloaded_error' })
        : new AIUnavailableError({ ...base, status: error.status });
    }
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      return errorForStatus(error.status, { ...base, upstreamType: error.type ?? undefined });
    }
    return new AIMalformedResponseError(base, 'unexpected client error');
  }
}

function mapStopReason(reason: string | null): AIStopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'other';
  }
}
