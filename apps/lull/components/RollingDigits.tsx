import type { CSSProperties } from 'react';

const COLUMN = Array.from({ length: 20 }, (_, k) => String(k % 10));

/**
 * One digit as a column of 0 to 9 twice, shifted to show `digit` in the second run, so the
 * `roll` keyframe (from translateY(0)) spins through more than a full turn. The window height
 * comes from `--dh` on an ancestor, in em. Purely visual: pair it with a readable value.
 */
export function RollingDigit({
  digit,
  className,
  style,
}: {
  digit: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="digit-win" aria-hidden="true">
      <span
        className={['digit-col', className ?? ''].filter(Boolean).join(' ')}
        style={{ transform: `translateY(calc(var(--dh) * -${10 + digit}))`, ...style }}
      >
        {COLUMN.map((value, k) => (
          <span key={k}>{value}</span>
        ))}
      </span>
    </span>
  );
}
