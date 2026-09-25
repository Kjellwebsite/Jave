import { Aborted, h, isTyping, sleep, waitFor } from './dom';

export interface ChoiceOpts {
  options: (Node | string)[];
  layout?: 'list' | 'grid2' | 'grid3' | 'row' | 'cards';
  /** Milliseconds before the question times out. */
  timeLimit?: number;
  /** Accepted keys per option. Defaults to 1, 2, 3 ... */
  keys?: string[][];
  className?: string;
}

export interface ChoiceResult {
  index: number | null;
  rt: number;
  buttons: HTMLButtonElement[];
}

export function timebar(ms: number): HTMLElement {
  const fill = h('span');
  fill.style.setProperty('--dur', `${ms}ms`);
  return h('div', { class: 'timebar', 'aria-hidden': 'true' }, fill);
}

/** Renders option buttons into `host` and resolves with the pick, or null on timeout. */
export async function choose(host: HTMLElement, opts: ChoiceOpts, signal: AbortSignal): Promise<ChoiceResult> {
  const keys = opts.keys ?? opts.options.map((_, i) => [String(i + 1)]);
  const buttons = opts.options.map((o, i) =>
    h('button', { class: 'opt', type: 'button', 'data-key': keys[i]?.[0]?.toUpperCase() }, o),
  );
  const wrap = h('div', { class: `opts opts-${opts.layout ?? 'list'} ${opts.className ?? ''}` }, buttons);
  host.append(wrap);
  const bar = opts.timeLimit ? timebar(opts.timeLimit) : null;
  if (bar) host.append(bar);

  const t0 = performance.now();
  const result = await waitFor<{ index: number | null; rt: number }>(signal, (resolve) => {
    const done = (index: number | null) => resolve({ index, rt: performance.now() - t0 });
    const handlers = buttons.map((b, i) => {
      const f = () => done(i);
      b.addEventListener('click', f);
      return f;
    });
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const i = keys.findIndex((ks) => ks.some((x) => x.toLowerCase() === k));
      if (i >= 0) {
        e.preventDefault();
        done(i);
      }
    };
    window.addEventListener('keydown', onKey);
    const timer = opts.timeLimit ? window.setTimeout(() => done(null), opts.timeLimit) : 0;
    return () => {
      buttons.forEach((b, i) => b.removeEventListener('click', handlers[i]));
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  });

  buttons.forEach((b) => (b.disabled = true));
  if (result.index !== null) buttons[result.index].classList.add('is-chosen');
  bar?.classList.add('is-stopped');
  return { ...result, buttons };
}

/** Marks the right answer (and a wrong pick) on option buttons. */
export function markAnswer(buttons: HTMLButtonElement[], correct: number, chosen: number | null) {
  buttons[correct]?.classList.add('is-correct');
  if (chosen !== null && chosen !== correct) buttons[chosen]?.classList.add('is-wrong');
}

export interface TextResult {
  text: string;
  rt: number;
  skipped: boolean;
}

export async function textAnswer(
  host: HTMLElement,
  opts: { placeholder: string; timeLimit?: number; id: string },
  signal: AbortSignal,
): Promise<TextResult> {
  const input = h('input', {
    id: opts.id,
    class: 'text-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: opts.placeholder,
    'aria-label': opts.placeholder,
  });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Submit');
  const skip = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Skip');
  const form = h('form', { class: 'text-answer' }, input, h('div', { class: 'text-answer-actions' }, submit, skip));
  host.append(form);
  const bar = opts.timeLimit ? timebar(opts.timeLimit) : null;
  if (bar) host.append(bar);
  input.focus({ preventScroll: true });

  const t0 = performance.now();
  const result = await waitFor<TextResult>(signal, (resolve) => {
    const finish = (skipped: boolean) =>
      resolve({ text: skipped ? '' : input.value.trim(), rt: performance.now() - t0, skipped });
    const onSubmit = (e: Event) => {
      e.preventDefault();
      if (input.value.trim()) finish(false);
      else input.focus();
    };
    const onSkip = () => finish(true);
    form.addEventListener('submit', onSubmit);
    skip.addEventListener('click', onSkip);
    const timer = opts.timeLimit ? window.setTimeout(() => finish(!input.value.trim()), opts.timeLimit) : 0;
    return () => {
      form.removeEventListener('submit', onSubmit);
      skip.removeEventListener('click', onSkip);
      clearTimeout(timer);
    };
  });
  input.disabled = true;
  submit.disabled = true;
  skip.disabled = true;
  bar?.classList.add('is-stopped');
  return result;
}

/** A primary button that also responds to Enter. */
export function continueButton(host: HTMLElement, label: string, signal: AbortSignal): Promise<void> {
  const btn = h('button', { class: 'btn btn-primary', type: 'button' }, label, h('span', { class: 'kbd-hint' }, 'Enter'));
  host.append(btn);
  btn.focus({ preventScroll: true });
  return waitFor<void>(signal, (resolve) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isTyping(e)) {
        e.preventDefault();
        resolve();
      }
    };
    const onClick = () => resolve();
    btn.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      btn.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      btn.disabled = true;
    };
  });
}

/** Brief correct / wrong message. */
export async function flash(host: HTMLElement, ok: boolean, text: string, ms: number, signal: AbortSignal) {
  const el = h('div', { class: `flash ${ok ? 'is-ok' : 'is-bad'}`, role: 'status' }, text);
  host.append(el);
  try {
    await sleep(ms, signal);
  } finally {
    el.remove();
  }
}

/** 3-2-1 count-in for timed tasks. */
export async function countIn(host: HTMLElement, signal: AbortSignal) {
  const el = h('div', { class: 'count-in', 'aria-live': 'polite' });
  host.append(el);
  try {
    for (const n of ['3', '2', '1']) {
      el.textContent = n;
      el.classList.remove('tick');
      void el.offsetWidth;
      el.classList.add('tick');
      await sleep(650, signal);
    }
  } finally {
    el.remove();
  }
}

/** Section card used between parts of a task. */
export async function interlude(host: HTMLElement, title: string, body: string, signal: AbortSignal, label = 'Continue') {
  const box = h('div', { class: 'interlude' }, h('h3', null, title), h('p', null, body));
  host.replaceChildren(box);
  await continueButton(box, label, signal);
}

export { Aborted };
