/* Core domain types shared by engine, scoring and UI. */

export type DomainId =
  | 'reasoning'
  | 'quant'
  | 'memory'
  | 'attention'
  | 'executive'
  | 'learning'
  | 'strategic'
  | 'metacognition'
  | 'social'
  | 'language'
  | 'natural';

/** Where a section's results are reported. Only `core` feeds the general estimate. */
export type SectionGroup = 'core' | 'performance' | 'creativity' | 'applied';

export type Band = 'foundation' | 'standard' | 'advanced' | 'elite' | 'apex';

export type Mode = 'quick' | 'core' | 'full' | 'single';

export type InputKind = 'mouse' | 'touch';

export interface IrtParams {
  a: number;
  b: number;
  c: number;
  calibration: 'provisional' | 'calibrated';
}

export type ResponseSpec =
  | { kind: 'choice'; options: number }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'text'; maxLength: number; charset: 'letters' | 'alnum' | 'any' };

export type ItemSource =
  | { kind: 'generated'; generator: string; seed: number }
  | { kind: 'authored'; author: string; reviewed: boolean };

export interface Item<C = unknown, K = unknown> {
  /** Stable id: paradigm:version:level:hash for generated items, paradigm:slug for authored. */
  id: string;
  version: number;
  paradigm: string;
  domain: DomainId;
  /** Content facet for balancing and reporting (e.g. "theory-of-mind"). */
  facet: string;
  level: number;
  band: Band;
  irt: IrtParams;
  timeLimitMs: number;
  response: ResponseSpec;
  content: C;
  key: K;
  features: Record<string, number | string | boolean>;
  explanation?: string;
  source: ItemSource;
}

export type ResponseValue =
  | { kind: 'choice'; index: number }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'timeout' };

export interface DeviceInfo {
  input: InputKind;
  viewport: 'small' | 'medium' | 'large';
  reducedMotion: boolean;
  /** Coarse, non-identifying browser family for timing context. */
  browser: string;
}

export interface ResponseRecord {
  stepId: string;
  itemId: string;
  paradigm: string;
  domain: DomainId;
  facet: string;
  level: number;
  irt: IrtParams;
  value: ResponseValue;
  correct: boolean;
  rtMs: number;
  timedOut: boolean;
  /** Faster than the paradigm's minimum plausible time: excluded from estimation. */
  rapid: boolean;
  /** Excluded for another reason (e.g. failed memory control). */
  excluded?: string;
  confidence?: number;
  at: number;
}

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit?: string;
  /** Human readable value, e.g. "412 ms". */
  display: string;
  /** Short explanation shown next to the value. */
  note?: string;
  /** Known reliability caveat from the literature. */
  caveat?: string;
  /** Status when the value cannot be interpreted yet. */
  status?: 'ok' | 'insufficient' | 'calibration-required' | 'not-scored';
}

/** An IRT-scorable outcome produced by a procedure (e.g. a solved learning problem). */
export interface ProcedureOutcome {
  itemId: string;
  facet: string;
  level: number;
  irt: IrtParams;
  correct: boolean;
}

export interface ProcedureScore {
  metrics: Metric[];
  outcomes?: ProcedureOutcome[];
  /** Arbitrary structured data for the report (curves, per-block values). */
  detail?: Record<string, unknown>;
}

export interface StopRule {
  minItems: number;
  maxItems: number;
  seTarget: number;
  /** Active response time budget for the section. */
  maxMs: number;
}

export interface SectionPlan {
  id: string;
  paradigm: string;
  practice: number;
  stop: StopRule;
  /** Share of measured items followed by a confidence probe. */
  confidenceRate: number;
  /** Options passed to procedure builders. */
  options?: Record<string, unknown>;
}

export interface PracticeRecord {
  stepId: string;
  itemId: string;
  correct: boolean;
}

export interface SectionState {
  id: string;
  paradigm: string;
  status: 'pending' | 'practice' | 'active' | 'done';
  practice: PracticeRecord[];
  /** Level candidates or bank item ids already used, for exposure and variety. */
  used: string[];
  responses: ResponseRecord[];
  procedure?: {
    config: unknown;
    result?: unknown;
    score?: ProcedureScore;
  };
  stopReason?: 'se' | 'max-items' | 'time' | 'procedure' | 'exhausted' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
}

export type PendingStep =
  | { type: 'practice'; stepId: string; section: number; item: Item; issuedAt: number; index: number }
  | { type: 'item'; stepId: string; section: number; item: Item; issuedAt: number; index: number; confidence: boolean }
  | { type: 'procedure'; stepId: string; section: number; config: unknown; issuedAt: number };

export interface SessionEvent {
  at: number;
  type: 'start' | 'resume' | 'void' | 'hidden' | 'visible' | 'duplicate' | 'pause' | 'complete' | 'section-start' | 'section-end';
  detail?: string;
}

export interface Session {
  schema: 1;
  id: string;
  seed: number;
  mode: Mode;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'complete';
  device: DeviceInfo;
  plan: SectionPlan[];
  sections: SectionState[];
  cursor: number;
  pending: PendingStep | null;
  /** Monotonic counter used to derive item seeds and step ids. */
  counter: number;
  events: SessionEvent[];
  attempt: number;
  /** Authored item ids seen in earlier sessions on this device; preferred last. */
  seen: string[];
}

export type Step =
  | { type: 'intro'; section: number }
  | PendingStep
  | { type: 'complete' };

export type Action =
  | { type: 'begin'; section: number }
  | { type: 'practice-answer'; stepId: string; value: ResponseValue }
  | { type: 'answer'; stepId: string; value: ResponseValue; rtMs: number; confidence?: number; aux?: ResponseValue }
  | { type: 'procedure-result'; stepId: string; result: unknown }
  | { type: 'skip-section'; section: number }
  | { type: 'event'; event: SessionEvent['type']; detail?: string };
