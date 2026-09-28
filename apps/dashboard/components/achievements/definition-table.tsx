import { Award } from 'lucide-react';
import { achievements } from '@jave/core';
import {
  Badge,
  Button,
  EmptyState,
  Mono,
  Panel,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import {
  type HolderShare,
  RARITY_LABELS,
  RARITY_TONE,
  type RuleEventOption,
  ruleText,
  type RuleView,
} from '@/lib/achievement-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { DefinitionDialog, EMPTY_DEFINITION, type DefinitionValues } from './definition-dialog';

type Definition = achievements.AchievementDefinitionRecord;

/** A stored rule that no longer validates is inert (null); the engine ignores it too. */
function storedRule(definition: Definition): RuleView | null {
  const parsed = achievements.achievementCriteriaSchema.safeParse(definition.criteria);
  return parsed.success ? parsed.data : null;
}

function formValues(definition: Definition): DefinitionValues {
  const rule = storedRule(definition);
  return {
    key: definition.key,
    title: definition.title,
    summary: definition.summary,
    description: definition.description,
    category: definition.category,
    rarity: definition.rarity,
    visibility: definition.visibility,
    ruleType: rule?.type === 'event_count' ? 'event_count' : 'manual',
    event: rule?.type === 'event_count' ? rule.event : EMPTY_DEFINITION.event,
    threshold: rule?.type === 'event_count' ? rule.threshold : EMPTY_DEFINITION.threshold,
    requiresVerification: definition.requiresVerification,
    facetKey: definition.facetKey,
    active: definition.active,
    ordinal: definition.ordinal,
  };
}

/** "12 · 4.1%": holders and their share of active members; "0" when nobody; "—" when inactive. */
function HeldBy({ share }: { share: HolderShare | undefined }) {
  if (!share) return <Mono dim>—</Mono>;
  if (share.holders === 0) return <Mono dim>0</Mono>;
  return (
    <Mono>
      {share.holders} · {share.percent}%
    </Mono>
  );
}

/** Catalog management: every definition with its rule, reach and state. */
export function DefinitionTable({
  definitions,
  shares,
  facets,
  events,
  updateAction,
  deleteAction,
}: {
  definitions: readonly Definition[];
  shares: ReadonlyMap<string, HolderShare> | null;
  facets: readonly { value: string; label: string }[];
  events: readonly RuleEventOption[];
  updateAction: FormAction;
  deleteAction: FormAction;
}) {
  const active = definitions.filter((definition) => definition.active).length;
  return (
    <Panel
      title="Catalog"
      description={`${definitions.length} defined · ${active} active. Hidden achievements are masked for members until unlocked. Held by: holders · share of active members.`}
      flush
    >
      {definitions.length === 0 ? (
        <EmptyState
          icon={Award}
          title="NO ACHIEVEMENTS YET"
          description="Seed the starter catalog or define the first achievement."
        />
      ) : (
        <Table caption="Achievement definitions">
          <TableHead>
            <tr>
              <TableHeaderCell>Achievement</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Rule</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell">Rarity</TableHeaderCell>
              <TableHeaderCell className="hidden lg:table-cell text-right">Held by</TableHeaderCell>
              <TableHeaderCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {definitions.map((definition) => {
              const share = shares?.get(definition.key);
              return (
                <TableRow key={definition.key} data-definition={definition.key}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-fg">{definition.title}</span>
                      {definition.visibility === 'hidden' ? <Badge>Hidden</Badge> : null}
                      {!definition.active ? <StatusBadge tone="neutral" label="INACTIVE" /> : null}
                    </span>
                    <span className="mt-0.5 block text-small text-fg-subtle">
                      {definition.summary}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <Mono dim className="text-[12px]">
                        {definition.key}
                      </Mono>
                      <span className="text-small text-fg-muted md:hidden">
                        {ruleText(storedRule(definition))}
                      </span>
                      <Badge tone={RARITY_TONE[definition.rarity]} className="sm:hidden">
                        {RARITY_LABELS[definition.rarity]}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-small text-fg-muted">
                      {ruleText(storedRule(definition))}
                    </span>
                    {definition.requiresVerification ? (
                      <span className="block text-small text-fg-subtle">Second-person verify</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge tone={RARITY_TONE[definition.rarity]}>
                      {RARITY_LABELS[definition.rarity]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right">
                    <HeldBy share={share} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      <DefinitionDialog
                        mode="edit"
                        values={formValues(definition)}
                        facets={facets}
                        events={events}
                        action={updateAction}
                        trigger={
                          <Button size="sm" variant="ghost" data-testid={`edit-${definition.key}`}>
                            Edit
                          </Button>
                        }
                      />
                      <ConfirmActionDialog
                        eyebrow="ACHIEVEMENTS"
                        title={`Delete ${definition.title}`}
                        description="Only an achievement nobody ever held and no mission rewards can be deleted. Otherwise deactivate it in Edit."
                        confirmLabel="Delete"
                        tone="danger"
                        action={deleteAction}
                        hidden={{ key: definition.key }}
                        trigger={
                          <Button size="sm" variant="ghost">
                            Delete
                          </Button>
                        }
                      />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
