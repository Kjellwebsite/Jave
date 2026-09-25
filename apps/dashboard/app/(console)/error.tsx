'use client';

import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { Button, ErrorState } from '@jave/ui';
import { referenceFromDigest } from '@/lib/error-reference';

export default function ConsoleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const reference = error.digest ? referenceFromDigest(error.digest) : null;
  useEffect(() => {
    // Server errors arrive redacted (digest only); the full stack is in the server log.
    console.error('view failed', reference ?? error);
  }, [error, reference]);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <ErrorState
        reference={reference}
        action={
          <Button iconLeft={RotateCw} onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
