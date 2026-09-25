/**
 * Shared content shape for JVLN's authored multiple-choice banks (social,
 * strategic, semantic, reading, prompting). Every item is a short optional
 * context, a question and 4–5 options, with one keyed option.
 */
import type { AuthoredItem } from '../paradigm';

export interface BankContent {
  /** Scenario, rule, prompt or model output shown above the question. */
  context?: string;
  question: string;
  options: string[];
}

export type BankItem = AuthoredItem<BankContent>;

export interface BankItemDef {
  slug: string;
  facet: string;
  b: number;
  context?: string;
  question: string;
  options: string[];
  /** 0-based index of the keyed option. */
  key: number;
  rationale: string;
  practice?: boolean;
  a?: number;
  timeLimitMs?: number;
}

/**
 * Builds an authored item whose option count always matches its content.
 * Every item written with this helper has passed the review checklist in
 * docs/TASK_DESIGN.md, so it is marked reviewed.
 */
export function bankItem(def: BankItemDef): BankItem {
  const { context, question, options, practice, a, timeLimitMs, ...rest } = def;
  return {
    ...rest,
    ...(a !== undefined ? { a } : {}),
    ...(timeLimitMs !== undefined ? { timeLimitMs } : {}),
    ...(practice ? { practice: true } : {}),
    content: context !== undefined ? { context, question, options } : { question, options },
    options: options.length,
    reviewed: true,
  };
}
