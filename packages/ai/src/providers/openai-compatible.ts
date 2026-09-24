import { z } from 'zod';
import {
  AIAbortedError,
  type AIError,
  AIMalformedResponseError,
  AIRefusalError,
  AITimeoutError,
  AIUnavailableError,
  errorForStatus,
  isAIError,
} from '../errors';
import { createDeadline, type FetchLike, joinUrl, readTextCapped } from '../http';
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

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** Chat completions are small; anything larger is hostile or misconfigured. */
export const MAX_COMPLETION_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

/**
 * OpenAI's current models take `max_completion_tokens`; most compatible
 * servers (Ollama, LM Studio, vLLM, DeepSeek) still take `max_tokens`.
 */
export type MaxTokensField = 'max_tokens' | 'max_completion_tokens';

export interface OpenAICompatibleOptions {
  /** Provider label recorded in the usage ledger, e.g. 'openai', 'openai-compatible'. */
  name?: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  maxTokensField?: MaxTokensField;
}

const completionSchema = z.object({
  model: z.string().max(200).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullable()
    .optional(),
});

const errorBodySchema = z.object({
  error: z.object({ type: z.string().max(64).optional() }).optional(),
});

/**
 * OpenAI Chat Completions over fetch. Covers OpenAI, DeepSeek and local
 * servers (Ollama, LM Studio, vLLM) through `baseUrl`.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly policy: RetryPolicy;
  private readonly maxTokensField: MaxTokensField;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name ?? 'openai-compatible';
    this.defaultModel = options.defaultModel;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.policy = retryPolicy(options.retry);
    this.maxTokensField = options.maxTokensField ?? 'max_tokens';
  }

  async complete(request: AIRequest, options: AICompleteOptions = {}): Promise<AIResponse> {
    const valid = validateRequest(request, this.name);
    const model = valid.model ?? this.defaultModel;
    const body = JSON.stringify({
      model,
      messages: [
        ...(valid.system ? [{ role: 'system', content: valid.system }] : []),
        ...valid.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      [this.maxTokensField]: valid.maxTokens,
      ...(valid.temperature !== undefined ? { temperature: valid.temperature } : {}),
      ...(valid.stop?.length ? { stop: valid.stop } : {}),
    });
    const started = performance.now();
    const raw = await withRetry(
      () => this.post('chat/completions', body, options.signal),
      this.policy,
      options.signal,
    );
    return this.toResponse(raw, model, started);
  }

  async health(): Promise<AIHealth> {
    const deadline = createDeadline(this.timeoutMs);
    try {
      const response = await this.fetchImpl(joinUrl(this.baseUrl, 'models'), {
        method: 'GET',
        headers: this.headers(),
        signal: deadline.signal,
        redirect: 'error',
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) {
        return {
          ok: false,
          detail: errorForStatus(response.status, { provider: this.name }).message,
        };
      }
      return { ok: true, detail: `${this.name} reachable · default model ${this.defaultModel}` };
    } catch (error) {
      return { ok: false, detail: this.mapFetchError(error, deadline.timedOut()).message };
    } finally {
      deadline.dispose();
    }
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private async post(path: string, body: string, signal?: AbortSignal): Promise<string> {
    const deadline = createDeadline(this.timeoutMs, signal);
    try {
      const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: deadline.signal,
        redirect: 'error',
      });
      if (!response.ok) throw await this.statusError(response);
      return await readTextCapped(response, MAX_COMPLETION_RESPONSE_BYTES, this.name);
    } catch (error) {
      throw this.mapFetchError(error, deadline.timedOut());
    } finally {
      deadline.dispose();
    }
  }

  private async statusError(response: Response): Promise<AIError> {
    let upstreamType: string | undefined;
    try {
      const text = await readTextCapped(response, MAX_ERROR_RESPONSE_BYTES, this.name);
      upstreamType = errorBodySchema.safeParse(JSON.parse(text)).data?.error?.type;
    } catch {
      upstreamType = undefined;
    }
    return errorForStatus(response.status, {
      provider: this.name,
      upstreamType,
      retryAfterMs: parseRetryAfterMs(response.headers),
    });
  }

  private mapFetchError(error: unknown, timedOut: boolean): AIError {
    if (isAIError(error)) return error;
    if (timedOut) return new AITimeoutError({ provider: this.name, timeoutMs: this.timeoutMs });
    if (error instanceof Error && error.name === 'AbortError') {
      return new AIAbortedError({ provider: this.name });
    }
    return new AIUnavailableError({ provider: this.name }, 'connection failed');
  }

  private toResponse(raw: string, requestedModel: string, started: number): AIResponse {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AIMalformedResponseError({ provider: this.name }, 'response is not JSON');
    }
    const parsed = completionSchema.safeParse(json);
    if (!parsed.success) {
      throw new AIMalformedResponseError({ provider: this.name }, 'unexpected response shape');
    }
    const choice = parsed.data.choices[0]!;
    if (choice.message.refusal || choice.finish_reason === 'content_filter') {
      throw new AIRefusalError({ provider: this.name });
    }
    return {
      text: choice.message.content ?? '',
      model: parsed.data.model ?? requestedModel,
      provider: this.name,
      stopReason: mapFinishReason(choice.finish_reason ?? null),
      usage: {
        inputTokens: nonNegativeInt(parsed.data.usage?.prompt_tokens),
        outputTokens: nonNegativeInt(parsed.data.usage?.completion_tokens),
      },
      latencyMs: elapsedMs(started),
    };
  }
}

function mapFinishReason(reason: string | null): AIStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    default:
      return 'other';
  }
}
