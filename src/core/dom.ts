export class Aborted extends Error {
  constructor() {
    super('aborted');
  }
}

type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, unknown> | null;

function applyProps(el: Element, props: Props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.setAttribute('class', String(value));
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign((el as HTMLElement).style, value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(el: Element, children: Child[]) {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** Tiny hyperscript helper for HTML elements. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props ?? null);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Same as h() for SVG elements. */
export function s(tag: string, props?: Props, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  applyProps(el, props ?? null);
  append(el, children);
  return el;
}

export function clear(el: Element) {
  el.replaceChildren();
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Aborted();
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const id = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves on the next animation frame with its timestamp. */
export function frame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Resolves once the current DOM state has been painted (two frames). */
export async function painted(): Promise<number> {
  await frame();
  return frame();
}

/**
 * Wraps a promise-producing setup so it rejects when the signal aborts.
 * `setup` receives resolve and returns a cleanup function.
 */
export function waitFor<T>(
  signal: AbortSignal,
  setup: (resolve: (value: T) => void) => () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    let cleanup: () => void = () => {};
    const onAbort = () => {
      cleanup();
      reject(new Aborted());
    };
    cleanup = setup((value) => {
      signal.removeEventListener('abort', onAbort);
      cleanup();
      resolve(value);
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Key presses are ignored while the user is typing in a field. */
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
