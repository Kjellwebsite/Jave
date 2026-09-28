import { type ReactNode, useEffect, useState } from 'react';
import { Hourglass, RotateCcw } from 'lucide-react';
import { Button, Emblem, EmptyState, ErrorState, Wordmark } from '@jave/ui';

const COUNTDOWN_TICK_MS = 1_000;
const MS_PER_SECOND = 1000;

/** `RETRYING IN 12 S`, ticking down to the scheduled automatic retry (local clock). */
function RetryCountdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.ceil((at - now) / MS_PER_SECOND));
  return (
    <p
      role="status"
      aria-live="polite"
      className="type-eyebrow text-fg-subtle"
      data-testid="retry-countdown"
    >
      {seconds > 0 ? `RETRYING IN ${seconds} S` : 'RETRYING'}
    </p>
  );
}

/** Centered identity frame for the moments before the console exists. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div aria-hidden className="blueprint-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="flex items-center gap-3">
        <Emblem size="md" />
        <Wordmark size="md" />
      </div>
      <div className="mt-8 w-full max-w-md">{children}</div>
    </main>
  );
}

export function SigningInScreen({ mode }: { mode: 'discord' | 'dev' }) {
  return (
    <Frame>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
        <span className="h-px w-40 overflow-hidden bg-line">
          <span className="skeleton-shimmer block h-px w-full" />
        </span>
        <p className="type-eyebrow text-fg-subtle">
          {mode === 'discord' ? 'AUTHENTICATING WITH DISCORD' : 'SIGNING IN · DEV PERSONA'}
        </p>
      </div>
    </Frame>
  );
}

export function FailureScreen({
  title,
  description,
  reference = null,
  retryAt = null,
  onRetry,
}: {
  title: string;
  description: string;
  reference?: string | null;
  /** An automatic retry is scheduled for then (local epoch ms): count down instead of asking. */
  retryAt?: number | null;
  onRetry?: () => void;
}) {
  // A scheduled retry is a wait, not an error: calm icon, a countdown, no button.
  if (retryAt !== null) {
    return (
      <Frame>
        <EmptyState
          icon={Hourglass}
          title={title}
          description={description}
          className="py-0"
          action={<RetryCountdown at={retryAt} />}
        />
      </Frame>
    );
  }
  return (
    <Frame>
      <ErrorState
        title={title}
        description={description}
        reference={reference}
        className="py-0"
        action={
          onRetry ? (
            <Button variant="secondary" iconLeft={RotateCcw} onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    </Frame>
  );
}
