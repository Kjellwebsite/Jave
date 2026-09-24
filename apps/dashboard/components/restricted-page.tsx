import Link from 'next/link';
import { buttonStyles, Card, PageHeader, RestrictedState } from '@jave/ui';
import type { Capability } from '@jave/core';

export interface RestrictedPageProps {
  eyebrow: string;
  title: string;
  capability: Capability;
}

/** The whole-page ACCESS RESTRICTED state: header for orientation, calm refusal below. */
export function RestrictedPage({ eyebrow, title, capability }: RestrictedPageProps) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card padding="none" className="mt-8">
        <RestrictedState
          requirement={capability}
          action={
            <Link href="/overview" className={buttonStyles({ variant: 'secondary' })}>
              Back to overview
            </Link>
          }
        />
      </Card>
    </>
  );
}
