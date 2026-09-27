import Link from 'next/link';
import { buttonStyles, Card, PageHeader, RestrictedState } from '@jave/ui';

export interface MemberOnlyPageProps {
  eyebrow: string;
  title: string;
}

/**
 * Events and games are read by any JAVELIN member; no capability unlocks
 * them. The refusal therefore names the profile, not a capability.
 */
export function MemberOnlyPage({ eyebrow, title }: MemberOnlyPageProps) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card padding="none" className="mt-8">
        <RestrictedState
          description="Events and games are open to JAVELIN members. Run /start in Discord to create your profile."
          requirement="JAVELIN profile"
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
