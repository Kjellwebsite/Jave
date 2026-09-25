export type DomainId =
  | 'reasoning'
  | 'memory'
  | 'speed'
  | 'executive'
  | 'learning'
  | 'decision'
  | 'creativity'
  | 'metacognition'
  | 'social'
  | 'language'
  | 'perception';

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type InputKind = 'touch' | 'mouse';

export interface Domain {
  id: DomainId;
  name: string;
  /** Every facet of the JVLN model for this domain. */
  facets: string[];
}

/** A single measured detail value shown in the report. */
export interface FacetResult {
  facet: string;
  display: string;
  note?: string;
}

/** A preference that has no better or worse end. Shown on a scale, never ranked. */
export interface StyleResult {
  name: string;
  left: string;
  right: string;
  /** 0 = fully left, 1 = fully right */
  value: number;
}

export interface TaskOutput {
  /** The primary score the rank is computed from. */
  score: number;
  /** Human readable version of the primary score, e.g. "6 blocks". */
  scoreDisplay: string;
  facets: FacetResult[];
  styles?: StyleResult[];
  /** Raw trial log, kept so scoring can be improved later. */
  trials: unknown[];
}

export interface TaskContext {
  stage: HTMLElement;
  input: InputKind;
  signal: AbortSignal;
  progress(done: number, total: number): void;
}

export interface TaskDef {
  id: string;
  domain: DomainId;
  name: string;
  tagline: string;
  minutes: number;
  /** Facets this task feeds. */
  measures: string[];
  instructions: string[];
  /** Needs sound. */
  audio?: boolean;
  run(ctx: TaskContext): Promise<TaskOutput>;
}

export interface Norm {
  mean: number;
  sd: number;
  higherIsBetter: boolean;
  /** Score is transformed with log10 before comparison. */
  log?: boolean;
  /** Device specific overrides, e.g. touch reaction times are slower. */
  byInput?: Partial<Record<InputKind, { mean: number; sd: number }>>;
}

export interface StoredResult {
  taskId: string;
  domain: DomainId;
  completedAt: string;
  input: InputKind;
  attempt: number;
  interrupted: boolean;
  z: number;
  percentile: number;
  rank: Rank;
  output: TaskOutput;
}
