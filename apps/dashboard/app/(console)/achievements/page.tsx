import type { Metadata } from 'next';
import { Plus, Sparkles } from 'lucide-react';
import { achievements, can } from '@jave/core';
import { Button, cx, LinkTabs, Mono, PageHeader, Stat } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { AwardControls } from '@/components/achievements/award-controls';
import { CatalogGrid } from '@/components/achievements/catalog-grid';
import { DefinitionDialog, EMPTY_DEFINITION } from '@/components/achievements/definition-dialog';
import { DefinitionTable } from '@/components/achievements/definition-table';
import { PendingAwards } from '@/components/achievements/pending-awards';
import { ConfirmActionDialog } from '@/components/forms/confirm-action-dialog';
import { firstParam, offsetParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { awardOptions, loadRarity, ruleEventOptions } from '@/server/data/achievements';
import { searchPresentMembers } from '@/server/data/member-search';
import { facetOptions } from '@/server/data/missions';
import { loadViewer } from '@/server/data/viewer';
import {
  awardAction,
  createDefinitionAction,
  deleteDefinitionAction,
  memberAwardsAction,
  revokeAction,
  searchAwardableMembersAction,
  seedStartersAction,
  updateDefinitionAction,
  verifyAwardAction,
} from './actions';

export const metadata: Metadata = { title: 'Achievements' };

/** Pending awards per page. */
const PENDING_PAGE_SIZE = 25;

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const manage = can(ctx, 'canManageAchievements');
  const award = can(ctx, 'canAwardAchievements');
  const tab = award && firstParam(params.tab) === 'pending' ? 'pending' : 'catalog';
  const [viewer, rarity, pending, catalog, definitions, facets, options, initialMembers] =
    await Promise.all([
      loadViewer(ctx),
      loadRarity(ctx),
      award
        ? achievements.listPendingAchievementAwards(ctx, {
            limit: PENDING_PAGE_SIZE,
            offset: tab === 'pending' ? offsetParam(params.offset) : 0,
          })
        : null,
      achievements.getAchievementCatalog(ctx),
      manage ? achievements.listAchievementDefinitions(ctx) : null,
      manage ? facetOptions(ctx) : [],
      award ? awardOptions(ctx) : [],
      award ? searchPresentMembers(ctx, '') : [],
    ]);
  const events = manage ? ruleEventOptions() : [];
  const tiles =
    award && rarity && pending
      ? [
          {
            label: 'ACHIEVEMENTS',
            value: catalog.length,
            hint: definitions ? `Active · ${definitions.length} defined` : 'Active in the catalog',
          },
          { label: 'UNLOCKS', value: rarity.unlocks, hint: 'Held by active members' },
          {
            label: 'ACTIVE MEMBERS',
            value: rarity.activeMembers,
            hint: 'Every share is of these',
          },
          {
            label: 'PENDING',
            value: pending.total,
            hint: 'Awaiting a second person',
            href: '/achievements?tab=pending',
          },
        ]
      : [];

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
                  search={searchAwardableMembersAction}
                  initial={initialMembers}
                  lookup={memberAwardsAction}
                  awardAction={awardAction}
                  revokeAction={revokeAction}
                />
              ) : null}
              {manage ? (
                <>
                  <ConfirmActionDialog
                    eyebrow="ACHIEVEMENTS"
                    title="Install the starter catalog"
                    description={`Adds the starter achievements that are missing (${achievements.STARTER_ACHIEVEMENTS.length} in the set). Existing keys stay exactly as edited; history is evaluated in the background without announcements.`}
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
                    events={events}
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

      {tiles.length > 0 ? (
        <section
          aria-label="Achievement readouts"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {tiles.map((tile) => (
            <Stat
              key={tile.label}
              label={tile.label}
              value={tile.value}
              hint={tile.hint}
              href={tile.href}
              linkComponent={NextLink}
              className={cx(tile.value === 0 && '[&_.type-numeral]:text-fg-subtle')}
            />
          ))}
        </section>
      ) : null}

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
      ) : definitions ? (
        <DefinitionTable
          definitions={definitions}
          shares={rarity?.byKey ?? null}
          facets={facets}
          events={events}
          updateAction={updateDefinitionAction}
          deleteAction={deleteDefinitionAction}
        />
      ) : (
        <CatalogGrid catalog={catalog} shares={rarity?.byKey ?? null} timeZone={viewer.timeZone} />
      )}
    </div>
  );
}
