import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, isUuid, missions } from '@jave/core';
import { Callout, Card, Icon, PageHeader, buttonStyles } from '@jave/ui';
import { MissionForm } from '@/components/missions/mission-form';
import { MissionLifecycle } from '@/components/missions/mission-lifecycle';
import { RestrictedPage } from '@/components/restricted-page';
import { requireConsoleContext } from '@/server/context';
import { facetOptions, rewardOptions } from '@/server/data/missions';
import { guarded } from '@/server/guard';
import { updateMissionAction } from '../../actions';

export const metadata: Metadata = { title: 'Edit mission' };

export default async function EditMissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  if (!can(ctx, 'canManageMissions'))
    return (
      <RestrictedPage eyebrow="OPERATIONS" title="Edit mission" capability="canManageMissions" />
    );
  const loaded = await guarded(() => missions.getMissionDetail(ctx, { missionId: id }));
  if (!loaded.ok) notFound();
  const { mission } = loaded.value;
  const [facets, rewards] = await Promise.all([
    facetOptions(ctx),
    rewardOptions(ctx, mission.reward),
  ]);
  const back = (
    <Link href={`/missions/${mission.id}`} className={buttonStyles({ variant: 'ghost' })}>
      <Icon icon={ArrowLeft} size="sm" />
      {mission.number}
    </Link>
  );
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`OPERATIONS / MISSIONS / ${mission.number}`}
        title="Edit mission"
        description="Changes apply immediately and refresh a posted Discord card. Existing due dates stay as they are."
        actions={back}
      />
      {mission.status === 'archived' ? (
        <Callout tone="neutral" className="max-w-3xl">
          Archived missions are final and cannot be edited.
        </Callout>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,48rem)_minmax(0,20rem)]">
          <Card>
            <MissionForm
              action={updateMissionAction}
              submitLabel="Save mission"
              typeLocked={mission.status !== 'draft'}
              facets={facets}
              rewards={rewards}
              values={{
                missionId: mission.id,
                title: mission.title,
                brief: mission.brief,
                type: mission.type,
                facetKey: mission.facetKey,
                evidenceRequired: mission.evidenceRequired,
                rewardAchievementKey:
                  mission.reward && !mission.reward.hidden ? mission.reward.key : null,
                rewardNote: mission.rewardNote,
                maxAssignees: mission.maxAssignees,
                selfAssignable: mission.selfAssignable,
                deadlineAt: mission.deadlineAt,
                durationHours: mission.durationHours,
              }}
            />
          </Card>
          <MissionLifecycle />
        </div>
      )}
    </div>
  );
}
