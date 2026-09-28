import { cx } from '@jave/ui';
import type { TriviaViewWire } from '../../api/contract';
import type { ServerClock } from '../../api/session';
import { useServerNow } from '../../hooks/use-server-now';
import { remainingFraction, secondsLeft } from '../../lib/arena';

/** The ring redraws a few times a second; the arc eases between frames (styles.css). */
const RING_FRAME_MS = 200;
const VIEWBOX = 64;
const STROKE = 3;
const RADIUS = (VIEWBOX - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The last seconds of a question read in the warning tone. */
const URGENT_SECONDS = 5;

export interface CountdownRingProps {
  view: TriviaViewWire;
  clock: ServerClock;
  /** Caption under the numeral, e.g. SEC or NEXT. */
  caption: string;
  className?: string;
}

/** Time left in the current window, from server time. Purely a display: the server decides. */
export function CountdownRing({ view, clock, caption, className }: CountdownRingProps) {
  const now = useServerNow(clock, RING_FRAME_MS);
  const fraction = remainingFraction(view, now);
  const seconds = secondsLeft(view, now);
  const urgent = view.phase === 'question' && seconds <= URGENT_SECONDS;
  return (
    <div
      role="timer"
      aria-label={`${seconds} seconds left`}
      className={cx('relative inline-flex shrink-0 items-center justify-center', className)}
    >
      <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="size-full -rotate-90" aria-hidden>
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-line"
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          className={cx('ring-progress', urgent ? 'stroke-warning' : 'stroke-fg')}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cx(
            'font-display text-[20px] font-medium leading-none tabular-nums',
            urgent ? 'text-warning' : 'text-fg',
          )}
        >
          {seconds}
        </span>
        <span className="type-eyebrow mt-1 text-[9px] text-fg-subtle">{caption}</span>
      </span>
    </div>
  );
}
