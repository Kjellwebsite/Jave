import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Emblem, ErrorState, Wordmark } from '@jave/ui';

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
  onRetry,
}: {
  title: string;
  description: string;
  reference?: string | null;
  onRetry?: () => void;
}) {
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
