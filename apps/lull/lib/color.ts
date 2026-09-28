/** Hex color helpers, ported from the prototype's `renderVals()` (`hx`, `toHex`, `mix`). */

type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

export function parseHex(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`Expected a #rrggbb color, got "${hex}"`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Linear blend in sRGB: `t = 0` returns `a`, `t = 1` returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** `#rrggbb` plus an alpha byte, e.g. `withAlpha('#1c1548', 0.18)` is `#1c15482e`. */
export function withAlpha(hex: string, alpha: number): string {
  parseHex(hex);
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return hex + byte.toString(16).padStart(2, '0');
}
