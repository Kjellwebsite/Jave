import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@jave/core';
import { Card, Icon, PageHeader, buttonStyles } from '@jave/ui';
import { MissionForm } from '@/components/missions/mission-form';
import { MissionLifecycle } from '@/components/missions/mission-lifecycle';
import { RestrictedPage } from '@/components/restricted-page';
import { requireConsoleContext } from '@/server/context';
import { facetOptions, rewardOptions } from '@/server/data/missions';
import { createMissionAction } from '../actions';

export const metadata: Metadata = { title: 'New mission' };

export default async function NewMissionPage() {
  const { ctx } = await requireConsoleContext();
  if (!can(ctx, 'canManageMissions'))
    return (
      <RestrictedPage eyebrow="OPERATIONS" title="New mission" capability="canManageMissions" />
    );
  const [facets, rewards] = await Promise.all([facetOptions(ctx), rewardOptions(ctx)]);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / MISSIONS"
        title="New mission"
        description="Missions start as drafts. Publishing opens them to members and posts the Discord card."
        actions={
          <Link href="/missions" className={buttonStyles({ variant: 'ghost' })}>
            <Icon icon={ArrowLeft} size="sm" />
            Missions
          </Link>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,48rem)_minmax(0,20rem)]">
        <Card>
          <MissionForm
            action={createMissionAction}
            submitLabel="Create draft"
            typeLocked={false}
            facets={facets}
            rewards={rewards}
            values={{
              title: '',
              brief: '',
              type: 'individual',
              facetKey: null,
              evidenceRequired: true,
              rewardAchievementKey: null,
              rewardNote: null,
              maxAssignees: null,
              selfAssignable: true,
              deadlineAt: null,
              durationHours: null,
            }}
          />
        </Card>
        <MissionLifecycle />
      </div>
    </div>
  );
}
