import type { Metadata } from 'next';
import { Plus, Sparkles } from 'lucide-react';
import { achievements, can, listMembers } from '@jave/core';
import { Button, LinkTabs, Mono, PageHeader } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { AwardControls } from '@/components/achievements/award-controls';
import { CatalogGrid } from '@/components/achievements/catalog-grid';
import { DefinitionDialog, EMPTY_DEFINITION } from '@/components/achievements/definition-dialog';
import { DefinitionTable } from '@/components/achievements/definition-table';
import { PendingAwards } from '@/components/achievements/pending-awards';
import { ConfirmActionDialog } from '@/components/forms/confirm-action-dialog';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { facetOptions } from '@/server/data/missions';
import { loadViewer } from '@/server/data/viewer';
import {
  awardAction,
  createDefinitionAction,
  deleteDefinitionAction,
  revokeAction,
  seedStartersAction,
  updateDefinitionAction,
  verifyAwardAction,
} from './actions';

export const metadata: Metadata = { title: 'Achievements' };

/** Handles suggested in the award dialog (it accepts any handle). */
const HANDLE_SUGGESTIONS = 100;

/** Share of active members per active achievement, keyed by key (masked entries have none). */
async function holderPercents(ctx: UserContext): Promise<Map<string, number> | null> {
  if (!can(ctx, 'canViewMembers')) return null;
  const stats = await achievements.getAchievementRarityStats(ctx);
  return new Map(
    stats.achievements.flatMap((stat) => (stat.masked ? [] : [[stat.key, stat.percent] as const])),
  );
}

async function awardOptions(ctx: UserContext) {
  const catalog = await achievements.getAchievementCatalog(ctx);
  return catalog.flatMap((entry) =>
    entry.masked ? [] : [{ value: entry.key, label: `${entry.title} · ${entry.rarity}` }],
  );
}

async function memberHandles(ctx: UserContext): Promise<string[]> {
  const page = await listMembers(ctx, {
    guildStatus: 'present',
    sort: 'name',
    limit: HANDLE_SUGGESTIONS,
  });
  return page.items.map((member) => member.handle);
}

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const manage = can(ctx, 'canManageAchievements');
  const award = can(ctx, 'canAwardAchievements');
  const tab = award && firstParam((await searchParams).tab) === 'pending' ? 'pending' : 'catalog';
  const [viewer, percents, pending, facets, options, handles] = await Promise.all([
    loadViewer(ctx),
    holderPercents(ctx),
    award ? achievements.listPendingAchievementAwards(ctx, { limit: 100 }) : null,
    manage ? facetOptions(ctx) : Promise.resolve([]),
    award ? awardOptions(ctx) : Promise.resolve([]),
    award ? memberHandles(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Achievements"
        description="Verified outcomes — a mission verified, a project shipped, a trial passed. Descriptive records, never a score, never activity."
        actions={
          manage || award ? (
            <>
              {award ? (
                <AwardControls
                  options={options}
                  handles={handles}
                  awardAction={awardAction}
                  revokeAction={revokeAction}
                />
              ) : null}
              {manage ? (
                <>
                  <ConfirmActionDialog
                    eyebrow="ACHIEVEMENTS"
                    title="Install the starter catalog"
                    description="Adds the thirteen starter achievements that are missing. Existing keys stay exactly as edited; history is evaluated in the background without announcements."
                    confirmLabel="Install starters"
                    action={seedStartersAction}
                    trigger={
                      <Button variant="ghost" iconLeft={Sparkles} data-testid="seed-starters">
                        Seed starters
                      </Button>
                    }
                  />
                  <DefinitionDialog
                    mode="create"
                    values={EMPTY_DEFINITION}
                    facets={facets}
                    action={createDefinitionAction}
                    trigger={
                      <Button variant="primary" iconLeft={Plus} data-testid="new-achievement">
                        New achievement
                      </Button>
                    }
                  />
                </>
              ) : null}
            </>
          ) : null
        }
      />

      {award ? (
        <LinkTabs
          label="Achievement sections"
          linkComponent={NextLink}
          tabs={[
            { href: '/achievements', label: 'Catalog', active: tab === 'catalog' },
            {
              href: '/achievements?tab=pending',
              label: 'Pending verification',
              active: tab === 'pending',
              meta: (
                <Mono dim className="text-[11px]">
                  {pending?.total ?? 0}
                </Mono>
              ),
            },
          ]}
        />
      ) : null}

      {tab === 'pending' && pending ? (
        <PendingAwards page={pending} timeZone={viewer.timeZone} verifyAction={verifyAwardAction} />
      ) : manage ? (
        <DefinitionTable
          definitions={await achievements.listAchievementDefinitions(ctx)}
          percents={percents}
          facets={facets}
          updateAction={updateDefinitionAction}
          deleteAction={deleteDefinitionAction}
        />
      ) : (
        <CatalogGrid
          catalog={await achievements.getAchievementCatalog(ctx)}
          percents={percents}
          timeZone={viewer.timeZone}
        />
      )}
    </div>
  );
}
