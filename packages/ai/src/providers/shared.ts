import { AIInvalidRequestError } from '../errors';
import { type AIRequest, aiRequestSchema } from '../types';

/** Default per-attempt timeout. Reasoning models can take a while on long answers. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** Validate a request before any network call. Never echoes content in the error. */
export function validateRequest(request: AIRequest, provider: string): AIRequest {
  const result = aiRequestSchema.safeParse(request);
  if (!result.success) {
    const field = result.error.issues[0]?.path.join('.') || 'request';
    throw new AIInvalidRequestError({ provider }, `invalid request field: ${field}`);
  }
  return result.data;
}

export function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
