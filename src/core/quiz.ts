import { h, sleep } from './dom';
import { shuffle } from './rng';
import type { TaskContext } from './types';
import { choose, markAnswer } from './ui';

export interface QuizItem {
  /** Optional context shown above the question, e.g. a short story. */
  context?: string;
  question: string;
  options: string[];
  /** Index into `options` of the right answer. */
  answer: number;
  tag: string;
}

export interface QuizTrial {
  tag: string;
  correct: boolean;
  rt: number;
  timedOut: boolean;
}

/** Runs multiple-choice items with shuffled options. */
export async function runQuiz(
  ctx: TaskContext,
  items: QuizItem[],
  opts: { timeLimit: number; showAnswer?: boolean },
): Promise<QuizTrial[]> {
  const trials: QuizTrial[] = [];
  for (let i = 0; i < items.length; i++) {
    ctx.progress(i, items.length);
    const item = items[i];
    const order = shuffle(item.options.map((_, j) => j));
    const nodes: Node[] = [];
    if (item.context) nodes.push(h('p', { class: 'quiz-context' }, item.context));
    nodes.push(h('p', { class: 'prompt quiz-question' }, item.question));
    ctx.stage.replaceChildren(...nodes);
    const res = await choose(ctx.stage, { options: order.map((j) => item.options[j]), layout: 'list', timeLimit: opts.timeLimit }, ctx.signal);
    const chosen = res.index === null ? null : order[res.index];
    const correct = chosen === item.answer;
    trials.push({ tag: item.tag, correct, rt: res.rt, timedOut: res.index === null });
    if (opts.showAnswer) {
      markAnswer(res.buttons, order.indexOf(item.answer), res.index);
      await sleep(900, ctx.signal);
    } else {
      await sleep(220, ctx.signal);
    }
  }
  ctx.progress(items.length, items.length);
  return trials;
}

export const countCorrect = (trials: QuizTrial[], tag?: string) =>
  trials.filter((t) => t.correct && (!tag || t.tag === tag)).length;

export const countTag = (trials: QuizTrial[], tag: string) => trials.filter((t) => t.tag === tag).length;
