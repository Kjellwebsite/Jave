import type { DeviceInfo } from '../types';

export function detectDevice(): DeviceInfo {
  const mq = (q: string) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const w = window.innerWidth;
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chromium' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return {
    input: mq('(pointer: coarse)') ? 'touch' : 'mouse',
    viewport: w < 640 ? 'small' : w < 1100 ? 'medium' : 'large',
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    browser,
  };
}
