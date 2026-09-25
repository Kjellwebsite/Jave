import type { InputKind, Item, ResponseValue } from '../../types';

export interface Reveal {
  key: unknown;
  chosen: ResponseValue | null;
  correct: boolean;
}

export interface ItemRendererProps<C = unknown> {
  item: Item<C>;
  practice: boolean;
  disabled: boolean;
  /** Set during practice feedback: renderers mark the key where they can. */
  reveal?: Reveal;
  /** rtMs overrides the stage's own clock (e.g. span tasks time from the end of presentation). */
  onAnswer(value: ResponseValue, opts?: { aux?: ResponseValue; rtMs?: number }): void;
}

export interface ProcedureRendererProps<Cfg = unknown> {
  config: Cfg;
  input: InputKind;
  onComplete(result: unknown): void;
}
