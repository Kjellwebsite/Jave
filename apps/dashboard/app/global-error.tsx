'use client';

import { ErrorState } from '@jave/ui';
import { referenceFromDigest } from '@/lib/error-reference';
import './globals.css';

/** Last-resort boundary (root layout failed). Renders its own document. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-canvas text-fg">
        <main className="flex min-h-dvh items-center justify-center px-4">
          <ErrorState
            reference={error.digest ? referenceFromDigest(error.digest) : null}
            action={
              <button
                type="button"
                onClick={retry}
                className="h-9 rounded-md border border-line-strong bg-surface-raised px-3.5 text-body text-fg"
              >
                Try again
              </button>
            }
          />
        </main>
      </body>
    </html>
  );
}
