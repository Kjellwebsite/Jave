import { seeded } from './trial';

/** Deterministic abstract glyph: three strokes on a 4×4 lattice. Meaningless by design. */
export function AbstractGlyph({ seed, size = 120 }: { seed: number; size?: number }) {
  const rand = seeded(seed);
  const pt = () => [15 + Math.floor(rand() * 4) * 23.3, 15 + Math.floor(rand() * 4) * 23.3];
  const strokes = Array.from({ length: 3 }, () => {
    const pts = Array.from({ length: 2 + Math.floor(rand() * 2) }, pt);
    return pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  });
  const dot = pt();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="abstract-glyph">
      {strokes.map((s, i) => (
        <polyline key={i} points={s} fill="none" stroke="#181a1d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <circle cx={dot[0]} cy={dot[1]} r="6" fill="#181a1d" />
    </svg>
  );
}
