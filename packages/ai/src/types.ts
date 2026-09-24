import { z } from 'zod';

/**
 * Provider-agnostic AI contract. Every provider (Anthropic, OpenAI-compatible,
 * disabled, mock) implements `AIProvider`; the domain layer never depends on a
 * specific vendor or model.
 */

export type AIRole = 'user' | 'assistant';

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIRequest {
  system: string;
  messages: readonly AIMessage[];
  /** Upper bound on generated tokens (including any model-internal reasoning). */
  maxTokens: number;
  /** Ignored by providers/models that do not accept sampling parameters. */
  temperature?: number;
  /** Overrides the provider's default model for this request. */
  model?: string;
  stop?: readonly string[];
}

/**
 * Why generation stopped. Refusals are never a stop reason: providers raise
 * `AIRefusalError` so a refusal cannot be mistaken for an answer.
 */
export type AIStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'other';

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResponse {
  text: string;
  /** Model that actually served the response (may differ from the request on fallback). */
  model: string;
  provider: string;
  stopReason: AIStopReason;
  usage: AIUsage;
  latencyMs: number;
}

export type AISurface = 'discord' | 'dashboard';

/** Who is asking and from where. Never contains prompt content. */
export interface AIContext {
  userId: string;
  feature: string;
  surface: AISurface;
}

export interface AICompleteOptions {
  signal?: AbortSignal;
  context?: AIContext;
}

export interface AIHealth {
  ok: boolean;
  detail: string;
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: AIRequest, options?: AICompleteOptions): Promise<AIResponse>;
  health(): Promise<AIHealth>;
}

/** Hard ceilings enforced by every provider before any network call. */
export const AI_REQUEST_LIMITS = {
  maxMessages: 64,
  maxMessageChars: 200_000,
  maxSystemChars: 50_000,
  maxTokens: 64_000,
  maxStopSequences: 4,
  maxStopSequenceChars: 64,
} as const;

export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@-]{1,64}$/;

export const aiRequestSchema = z.object({
  system: z.string().max(AI_REQUEST_LIMITS.maxSystemChars),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(AI_REQUEST_LIMITS.maxMessageChars),
      }),
    )
    .min(1)
    .max(AI_REQUEST_LIMITS.maxMessages)
    .refine((messages) => messages[0]?.role === 'user', 'the first message must be from the user'),
  maxTokens: z.number().int().min(1).max(AI_REQUEST_LIMITS.maxTokens),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().regex(MODEL_ID_PATTERN, 'invalid model id').optional(),
  stop: z
    .array(z.string().min(1).max(AI_REQUEST_LIMITS.maxStopSequenceChars))
    .max(AI_REQUEST_LIMITS.maxStopSequences)
    .optional(),
});
