import { useEffect } from 'react';
import { Check, Lock, X } from 'lucide-react';
import { Badge, cx, Icon } from '@jave/ui';
import type { ArenaSessionWire, TriviaViewWire } from '../../api/contract';
import type { ServerClock } from '../../api/session';
import type { LockedAnswer } from '../../hooks/use-arena';
import { OPTION_KEYS } from '../../lib/arena';
import { enumLabel } from '../../lib/format';
import { CountdownRing } from './countdown-ring';
import { Scoreboard } from './scoreboard';

type TileState = 'open' | 'watch' | 'locked' | 'dimmed' | 'correct' | 'wrong';

const TILE: Record<TileState, string> = {
  open: 'cursor-pointer border-line-strong bg-surface-raised shadow-highlight hover:border-fg-faint hover:bg-surface-overlay',
  watch: 'border-line-strong bg-surface-raised',
  locked: 'border-fg bg-surface-overlay shadow-highlight',
  dimmed: 'border-line bg-surface opacity-45',
  correct: 'border-success/60 bg-success/8',
  wrong: 'border-danger/60 bg-danger/8',
};

const KEY_PLATE: Record<TileState, string> = {
  open: 'border-line-strong text-fg-muted',
  watch: 'border-line-strong text-fg-subtle',
  locked: 'chrome-plate border-transparent',
  dimmed: 'border-line text-fg-faint',
  correct: 'border-success/50 text-success',
  wrong: 'border-danger/50 text-danger',
};

/** Round rail segments: finished rounds, the round on screen, rounds to come. */
const RAIL_SEGMENT = {
  done: 'bg-fg-subtle',
  current: 'bg-fg',
  next: 'bg-line-strong',
} as const;
const ROUND_DIGITS = 2;

const padRound = (value: number) => String(value).padStart(ROUND_DIGITS, '0');

/** Where the game stands: one segment per round. Decorative; the label carries the numbers. */
function RoundRail({ view }: { view: TriviaViewWire }) {
  return (
    <div aria-hidden className="flex gap-1" data-testid="round-rail">
      {Array.from({ length: view.totalRounds }, (_, index) => {
        const number = index + 1;
        const state =
          number < view.round || (number === view.round && view.phase !== 'question')
            ? 'done'
            : number === view.round
              ? 'current'
              : 'next';
        return (
          <span key={number} className={cx('h-0.5 flex-1 rounded-full', RAIL_SEGMENT[state])} />
        );
      })}
    </div>
  );
}

/** Keyboard answers: A–D and 1–4. */
const KEY_TO_CHOICE: Readonly<Record<string, number>> = {
  a: 0,
  b: 1,
  c: 2,
  d: 3,
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

function tileState(
  index: number,
  view: TriviaViewWire,
  choice: number | null,
  canAnswer: boolean,
): TileState {
  if (view.phase === 'reveal' || view.phase === 'finished') {
    if (index === view.correctIndex) return 'correct';
    if (index === choice) return 'wrong';
    return 'dimmed';
  }
  if (choice === null) return canAnswer ? 'open' : 'watch';
  return index === choice ? 'locked' : 'dimmed';
}

const TAG: Partial<Record<TileState, { label: string; icon: typeof Check; tone: string }>> = {
  locked: { label: 'LOCKED IN', icon: Lock, tone: 'text-fg' },
  correct: { label: 'CORRECT', icon: Check, tone: 'text-success' },
  wrong: { label: 'YOUR ANSWER', icon: X, tone: 'text-danger' },
};

function StatusLine({
  session,
  view,
  choice,
}: {
  session: ArenaSessionWire;
  view: TriviaViewWire;
  choice: number | null;
}) {
  if (!session.youArePlayer) {
    return (
      <p className="text-small text-fg-subtle">
        <span className="type-eyebrow mr-2 text-fg-muted">SPECTATING</span>
        Answers stay hidden until the reveal.
      </p>
    );
  }
  if (view.phase === 'question') {
    if (choice === null) {
      return (
        <p className="text-small text-fg-subtle">
          Faster correct answers earn more.
          <span className="hidden md:inline"> Keys A–D or 1–4.</span>
          {/* Phones show the standings below the fold: keep the live count in view. */}
          <span className="type-data ml-2 text-fg-muted lg:hidden" data-testid="answered-count">
            {view.answeredCount}/{view.playerCount} ANSWERED
          </span>
        </p>
      );
    }
    // An answer still in flight is not in the server's count yet.
    const answered = view.answeredCount + (view.you?.answered ? 0 : 1);
    const waiting = Math.max(0, view.playerCount - answered);
    return (
      <p className="text-small text-fg-muted" data-testid="round-status">
        <span className="type-eyebrow mr-2 text-fg">LOCKED IN</span>
        {waiting > 0
          ? `Waiting for ${waiting} more ${waiting === 1 ? 'player' : 'players'}.`
          : 'Closing the round.'}
      </p>
    );
  }
  const you = view.you;
  if (you?.correct === true) {
    return (
      <p className="type-eyebrow text-success" data-testid="round-status">
        CORRECT — +{you.points ?? 0} POINTS
      </p>
    );
  }
  return (
    <p className="type-eyebrow text-fg-muted" data-testid="round-status">
      {you?.answered ? 'INCORRECT — 0 POINTS' : 'NO ANSWER — 0 POINTS'}
    </p>
  );
}

export interface RoundProps {
  session: ArenaSessionWire;
  view: TriviaViewWire;
  clock: ServerClock;
  locked: LockedAnswer | null;
  submitting: boolean;
  /** Keyboard answers only while the Arena is on screen. */
  active: boolean;
  onAnswer: (choice: number) => void;
}

/** One trivia round: the question with its countdown, then the reveal with the fact. */
export function Round({ session, view, clock, locked, submitting, active, onAnswer }: RoundProps) {
  const optimistic =
    locked && locked.sessionId === session.id && locked.round === view.round ? locked.choice : null;
  const choice = view.you?.choice ?? optimistic;
  const canAnswer =
    session.youArePlayer && view.phase === 'question' && choice === null && !submitting;
  const options = view.question?.options ?? [];
  const lastRound = view.round >= view.totalRounds;

  useEffect(() => {
    if (!active || !canAnswer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const index = KEY_TO_CHOICE[event.key.toLowerCase()];
      if (index === undefined || index >= options.length) return;
      event.preventDefault();
      onAnswer(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, canAnswer, onAnswer, options.length]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section
        aria-label={`Round ${view.round} of ${view.totalRounds}`}
        className="machined relative rounded-lg border border-line bg-surface p-5 sm:p-6 lg:p-8"
        data-testid="round"
        data-phase={view.phase}
        data-round={view.round}
      >
        <RoundRail view={view} />
        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="type-eyebrow text-fg-subtle">
              ROUND {padRound(view.round)} / {padRound(view.totalRounds)}
            </p>
            {view.question ? (
              <div className="flex flex-wrap gap-1.5">
                <Badge>{enumLabel(view.question.category)}</Badge>
                <Badge>{enumLabel(view.question.difficulty)}</Badge>
              </div>
            ) : null}
          </div>
          <CountdownRing
            view={view}
            clock={clock}
            caption={view.phase === 'question' ? 'SEC' : lastRound ? 'END' : 'NEXT'}
            className="size-16 sm:size-[72px]"
          />
        </div>

        <h2
          className="mt-5 text-[19px] font-medium leading-snug text-fg sm:text-[22px] lg:mt-6 lg:text-[26px]"
          data-testid="question-prompt"
        >
          {view.question?.prompt ?? 'Preparing the round.'}
        </h2>

        <div
          className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:mt-7 lg:gap-3"
          role="group"
          aria-label="Answers"
        >
          {options.map((option, index) => {
            const state = tileState(index, view, choice, canAnswer);
            const tag = TAG[state];
            return (
              <button
                key={`${view.round}-${index}`}
                type="button"
                disabled={state !== 'open'}
                aria-pressed={state === 'locked' || undefined}
                onClick={() => onAnswer(index)}
                data-testid={`option-${index}`}
                data-state={state}
                className={cx(
                  'relative flex min-h-14 w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color,opacity] disabled:cursor-default lg:min-h-[68px] lg:px-4',
                  TILE[state],
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'type-eyebrow flex size-7 shrink-0 items-center justify-center rounded-sm border',
                    KEY_PLATE[state],
                  )}
                >
                  {OPTION_KEYS[index]}
                </span>
                <span className="min-w-0 flex-1 text-body text-fg lg:text-[15px]">{option}</span>
                {tag ? (
                  <span className={cx('type-eyebrow flex shrink-0 items-center gap-1', tag.tone)}>
                    <Icon icon={tag.icon} size="sm" />
                    <span className="hidden sm:inline">{tag.label}</span>
                    <span className="sr-only sm:hidden">{tag.label}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
          <StatusLine session={session} view={view} choice={choice} />
          {view.phase !== 'question' && lastRound ? (
            <span className="type-eyebrow text-fg-subtle">FINAL STANDINGS NEXT</span>
          ) : null}
        </div>

        {view.phase !== 'question' && view.fact ? (
          <div className="mt-4 rounded-md border border-line bg-surface-sunken px-4 py-3">
            <p className="type-eyebrow text-fg-subtle">FACT</p>
            <p className="mt-1 text-small text-fg-muted" data-testid="reveal-fact">
              {view.fact}
            </p>
          </div>
        ) : null}
      </section>

      <Scoreboard view={view} />
    </div>
  );
}
