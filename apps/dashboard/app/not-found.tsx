import Link from 'next/link';
import { connection } from 'next/server';
import { Compass } from 'lucide-react';
import { buttonStyles, EmptyState } from '@jave/ui';

export default async function NotFound() {
  // Rendered per request: the CSP nonce only reaches dynamically rendered pages.
  await connection();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={Compass}
        title="NOT FOUND"
        description="Nothing exists at this address, or it is not visible to you."
        action={
          <Link href="/" className={buttonStyles({ variant: 'secondary' })}>
            Return to JAVELIN
          </Link>
        }
      />
    </main>
  );
}
