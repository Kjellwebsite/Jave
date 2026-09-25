/**
 * Timing helpers for performance tasks. Stimuli are written directly to the DOM
 * inside refs; onsets are the timestamp of the frame after the change, and
 * responses use event.timeStamp (same clock as performance.now and rAF).
 */

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Cancelled());
    const t = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Timestamp of the frame on which the current DOM state is first shown. */
export function paintTime(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame((t) => resolve(t))));
}

export interface ResponseSpec<T> {
  /** Map from KeyboardEvent.key (lowercase) to response value. */
  keys?: Record<string, T>;
  /** Clickable/tappable elements and their values. */
  targets?: { el: HTMLElement | null; value: T }[];
  timeoutMs: number;
  signal: AbortSignal;
}

export interface Response<T> {
  value: T | null;
  t: number;
}

/** Resolves with the first response or null at timeout. */
export function waitResponse<T>(spec: ResponseSpec<T>): Promise<Response<T>> {
  return new Promise((resolve, reject) => {
    if (spec.signal.aborted) return reject(new Cancelled());
    let done = false;
    const cleanups: (() => void)[] = [];
    const finish = (r: Response<T>) => {
      if (done) return;
      done = true;
      cleanups.forEach((c) => c());
      resolve(r);
    };
    if (spec.keys) {
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k in spec.keys!) {
          e.preventDefault();
          finish({ value: spec.keys![k], t: e.timeStamp });
        }
      };
      window.addEventListener('keydown', onKey);
      cleanups.push(() => window.removeEventListener('keydown', onKey));
    }
    for (const target of spec.targets ?? []) {
      if (!target.el) continue;
      const el = target.el;
      const onDown = (e: PointerEvent) => {
        e.preventDefault();
        finish({ value: target.value, t: e.timeStamp });
      };
      el.addEventListener('pointerdown', onDown);
      cleanups.push(() => el.removeEventListener('pointerdown', onDown));
    }
    const timer = window.setTimeout(() => finish({ value: null, t: performance.now() }), spec.timeoutMs);
    cleanups.push(() => clearTimeout(timer));
    const onAbort = () => {
      if (done) return;
      done = true;
      cleanups.forEach((c) => c());
      reject(new Cancelled());
    };
    spec.signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => spec.signal.removeEventListener('abort', onAbort));
  });
}

/** Seeded RNG for layouts inside renderers (mulberry32). */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
