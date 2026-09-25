import { bandFor, provisional } from '../adaptive/irt';
import type { Candidate } from '../adaptive/select';
import type {
  DomainId,
  Item,
  Mode,
  ProcedureScore,
  ResponseSpec,
  ResponseValue,
  SectionGroup,
  SectionPlan,
  Session,
} from '../types';
import { hashSeed, type Rng } from '../utils/rng';

export interface ParadigmInfo {
  id: string;
  domain: DomainId;
  group: SectionGroup;
  /** Short display name, e.g. "Matrix inference". */
  title: string;
  /** One line under the title, e.g. "Find the rule. Complete the pattern." */
  subtitle: string;
  /** Construct measured, in plain words. */
  construct: string;
  /** Instructions shown before practice. */
  instructions: string[];
  /** Typical minutes in Core mode. */
  minutes: number;
  /** JVLN construct without established psychometric standing. */
  experimental?: boolean;
  /** Knowledge-loaded or reasoning-loaded (language items). */
  load?: 'knowledge' | 'reasoning';
  /** Recommended input. Timed perceptual tasks prefer a keyboard. */
  input?: 'any' | 'keyboard-preferred';
}

export interface ScoreResult {
  correct: boolean;
  /** Reason to exclude from estimation even though answered (e.g. failed memory control). */
  excluded?: string;
}

export interface ItemParadigm extends ParadigmInfo {
  kind: 'items';
  /** Responses faster than this are rapid guesses (Wise & Kong, 2005). */
  minRtMs: number;
  /** Levels (generators) or unused items (banks) available for selection. */
  candidates(used: readonly string[]): Candidate[];
  /** Build the item for a selected candidate key. */
  instantiate(key: string, rng: Rng): Item;
  practice(rng: Rng, n: number): Item[];
  score(item: Item, value: ResponseValue, aux?: ResponseValue): ScoreResult;
  /** Easiest and hardest available difficulty, for floor and ceiling flags. */
  range(): { minB: number; maxB: number };
  facetTargets?: Record<string, number>;
}

export interface ProcedureContext {
  mode: Mode;
  plan: SectionPlan;
  session: Session;
}

export interface ProcedureParadigm<Config = unknown, Result = unknown> extends ParadigmInfo {
  kind: 'procedure';
  build(rng: Rng, ctx: ProcedureContext): Config;
  /** Reject malformed results from the UI. */
  validate(result: unknown): result is Result;
  score(config: Config, result: Result, rng: Rng): ProcedureScore;
}

export type Paradigm = ItemParadigm | ProcedureParadigm;

/* ------------------------------------------------------------------ */
/* Generator helper                                                     */
/* ------------------------------------------------------------------ */

export interface LevelSpec {
  level: number;
  a: number;
  b: number;
  /** Lower asymptote. 0 for constructed responses. */
  c: number;
  timeLimitMs: number;
}

export interface Generated<C, K> {
  content: C;
  key: K;
  response: ResponseSpec;
  features: Record<string, number | string | boolean>;
  explanation?: string;
  facet?: string;
}

export interface GeneratorDef<C, K> extends ParadigmInfo {
  version: number;
  facet: string;
  minRtMs: number;
  levels: LevelSpec[];
  generate(level: number, rng: Rng): Generated<C, K>;
  /** Practice uses the easiest levels unless overridden. */
  practiceLevels?: number[];
  check?(item: Item<C, K>, value: ResponseValue, aux?: ResponseValue): ScoreResult;
}

export function defaultCheck(item: Item, value: ResponseValue): ScoreResult {
  const key = item.key;
  switch (value.kind) {
    case 'choice':
      return { correct: value.index === key };
    case 'number':
      return { correct: value.value === key };
    case 'text':
      return { correct: normalizeText(value.value) === normalizeText(String(key)) };
    default:
      return { correct: false };
  }
}

export const normalizeText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function generatorParadigm<C, K>(def: GeneratorDef<C, K>): ItemParadigm {
  const byLevel = new Map(def.levels.map((l) => [l.level, l]));
  const make = (level: number, rng: Rng): Item<C, K> => {
    const spec = byLevel.get(level);
    if (!spec) throw new Error(`${def.id}: unknown level ${level}`);
    const g = def.generate(level, rng);
    const hash = hashSeed(def.id, level, JSON.stringify(g.content)).toString(36);
    return {
      id: `${def.id}:v${def.version}:L${level}:${hash}`,
      version: def.version,
      paradigm: def.id,
      domain: def.domain,
      facet: g.facet ?? def.facet,
      level,
      band: bandFor(spec.b),
      irt: provisional(spec.a, spec.b, spec.c),
      timeLimitMs: spec.timeLimitMs,
      response: g.response,
      content: g.content,
      key: g.key,
      features: g.features,
      explanation: g.explanation,
      source: { kind: 'generated', generator: `${def.id}@${def.version}`, seed: rng.seed },
    };
  };
  const levels = def.levels.map((l) => l.level);
  return {
    ...def,
    kind: 'items',
    candidates: () => def.levels.map((l) => ({ key: String(l.level), irt: { a: l.a, b: l.b, c: l.c } })),
    instantiate: (key, rng) => make(Number(key), rng) as Item,
    practice: (rng, n) => {
      const pl = def.practiceLevels ?? levels.slice(0, Math.max(1, n));
      return Array.from({ length: n }, (_, i) => make(pl[Math.min(i, pl.length - 1)], rng.fork(`practice-${i}`)) as Item);
    },
    score: (item, value, aux) => (def.check ? def.check(item as Item<C, K>, value, aux) : defaultCheck(item, value)),
    range: () => ({ minB: Math.min(...def.levels.map((l) => l.b)), maxB: Math.max(...def.levels.map((l) => l.b)) }),
  };
}

/* ------------------------------------------------------------------ */
/* Authored bank helper                                                 */
/* ------------------------------------------------------------------ */

export interface AuthoredItem<C = unknown> {
  slug: string;
  facet: string;
  /** Provisional difficulty on the θ scale. */
  b: number;
  a?: number;
  content: C;
  /** Index of the correct option. */
  key: number;
  options: number;
  rationale: string;
  reviewed: boolean;
  practice?: boolean;
  timeLimitMs?: number;
}

export interface BankDef<C> extends ParadigmInfo {
  version: number;
  minRtMs: number;
  items: AuthoredItem<C>[];
  facetTargets?: Record<string, number>;
  defaultA?: number;
  defaultTimeLimitMs?: number;
}

export function bankParadigm<C>(def: BankDef<C>): ItemParadigm {
  const live = def.items.filter((i) => i.reviewed && !i.practice);
  const practice = def.items.filter((i) => i.reviewed && i.practice);
  const toItem = (a: AuthoredItem<C>): Item => {
    const aParam = a.a ?? def.defaultA ?? 1.3;
    return {
      id: `${def.id}:${a.slug}`,
      version: def.version,
      paradigm: def.id,
      domain: def.domain,
      facet: a.facet,
      level: Math.round(a.b * 10) / 10,
      band: bandFor(a.b),
      irt: provisional(aParam, a.b, 1 / a.options),
      timeLimitMs: a.timeLimitMs ?? def.defaultTimeLimitMs ?? 90_000,
      response: { kind: 'choice', options: a.options },
      content: a.content,
      key: a.key,
      features: { facet: a.facet, authored: true },
      explanation: a.rationale,
      source: { kind: 'authored', author: 'JVLN', reviewed: a.reviewed },
    };
  };
  const bySlug = new Map(def.items.map((i) => [i.slug, i]));
  return {
    ...def,
    kind: 'items',
    candidates: (used) =>
      live
        .filter((i) => !used.includes(`${def.id}:${i.slug}`))
        .map((i) => ({ key: i.slug, irt: { a: i.a ?? def.defaultA ?? 1.3, b: i.b, c: 1 / i.options }, facet: i.facet })),
    instantiate: (key) => {
      const a = bySlug.get(key);
      if (!a) throw new Error(`${def.id}: unknown item ${key}`);
      return toItem(a);
    },
    practice: (rng, n) => rng.shuffle(practice).slice(0, n).map(toItem),
    score: defaultCheck,
    range: () => ({ minB: Math.min(...live.map((i) => i.b)), maxB: Math.max(...live.map((i) => i.b)) }),
  };
}
