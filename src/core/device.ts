import type { InputKind } from './types';

/** Touch screens have slower, noisier response times, so they are normed separately. */
export function detectInput(): InputKind {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  } catch {
    return 'mouse';
  }
}
