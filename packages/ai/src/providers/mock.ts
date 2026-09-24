import { createHash } from 'node:crypto';
import type {
  AICompleteOptions,
  AIContext,
  AIHealth,
  AIProvider,
  AIRequest,
  AIResponse,
} from '../types';
import { validateRequest } from './shared';

/**
 * MOCK / DEVELOPMENT ONLY. Deterministic provider for tests and local
 * development. `createProviderFromEnv` refuses it outside development/test.
 */
export const MOCK_PROVIDER_NAME = 'mock';
export const MOCK_DEFAULT_MODEL = 'mock-deterministic-1';
/** Recorded calls kept for inspection; older entries are dropped. */
export const MOCK_CALL_HISTORY_LIMIT = 100;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export interface MockCall {
  request: AIRequest;
  context?: AIContext;
}

/** Return text, a partial response, or throw an AIError to simulate failures. */
export type MockResponder = (
  request: AIRequest,
  options: AICompleteOptions,
) => string | Partial<AIResponse> | Promise<string | Partial<AIResponse>>;

export interface MockProviderOptions {
  model?: string;
  respond?: MockResponder;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export class MockProvider implements AIProvider {
  readonly name = MOCK_PROVIDER_NAME;
  readonly defaultModel: string;
  private readonly respond?: MockResponder;
  private readonly history: MockCall[] = [];

  constructor(options: MockProviderOptions = {}) {
    this.defaultModel = options.model ?? MOCK_DEFAULT_MODEL;
    this.respond = options.respond;
  }

  /** Requests received so far (most recent last). */
  get calls(): readonly MockCall[] {
    return this.history;
  }

  async complete(request: AIRequest, options: AICompleteOptions = {}): Promise<AIResponse> {
    const valid = validateRequest(request, this.name);
    this.history.push({ request: valid, context: options.context });
    if (this.history.length > MOCK_CALL_HISTORY_LIMIT) this.history.shift();
    const model = valid.model ?? this.defaultModel;
    const inputText = valid.system + valid.messages.map((m) => m.content).join('');
    const scripted = this.respond ? await this.respond(valid, options) : this.defaultText(valid);
    const partial = typeof scripted === 'string' ? { text: scripted } : scripted;
    const text = partial.text ?? '';
    return {
      text,
      model: partial.model ?? model,
      provider: this.name,
      stopReason: partial.stopReason ?? 'end_turn',
      usage: partial.usage ?? {
        inputTokens: estimateTokens(inputText),
        outputTokens: estimateTokens(text),
      },
      latencyMs: partial.latencyMs ?? 0,
    };
  }

  async health(): Promise<AIHealth> {
    return { ok: true, detail: 'MOCK / DEVELOPMENT ONLY provider' };
  }

  private defaultText(request: AIRequest): string {
    const last = request.messages[request.messages.length - 1]?.content ?? '';
    const digest = createHash('sha256').update(last).digest('hex').slice(0, 12);
    return `MOCK / DEVELOPMENT ONLY — deterministic reply ${digest}. Received ${request.messages.length} message(s), ${last.length} characters.`;
  }
}
