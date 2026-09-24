import { AIDisabledError } from '../errors';
import type { AIHealth, AIProvider, AIResponse } from '../types';

export const DISABLED_PROVIDER_NAME = 'disabled';

/** AI_PROVIDER=disabled: every call fails with a clear, non-retryable error. */
export class DisabledProvider implements AIProvider {
  readonly name = DISABLED_PROVIDER_NAME;
  readonly defaultModel = 'none';

  async complete(): Promise<AIResponse> {
    throw new AIDisabledError({ provider: this.name });
  }

  async health(): Promise<AIHealth> {
    return { ok: false, detail: 'AI is disabled (AI_PROVIDER=disabled)' };
  }
}
