import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, LayoutTemplate, PackagePlus, Plus } from 'lucide-react';
import { can, trials } from '@jave/core';
import {
  Badge,
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { RestrictedPage } from '@/components/restricted-page';
import { ActionButton } from '@/components/trials/action-button';
import { categoryLabel } from '@/lib/trial-labels';
import { requireConsoleContext } from '@/server/context';
import { guarded } from '@/server/guard';
import { seedTemplatesAction } from '../actions';

export const metadata: Metadata = { title: 'Trial templates' };

export default async function TemplatesPage() {
  const { ctx } = await requireConsoleContext();
  const loaded = await guarded(() => trials.listTemplates(ctx, { includeInactive: true }));
  if (!loaded.ok)
    return (
      <RestrictedPage eyebrow="OPERATIONS / TRIALS" title="Templates" capability="canManageTrials" />
    );
  const templates = loaded.value;
  const seeAdversarial = can(ctx, 'canManageAdversarial');
  const active = templates.filter((template) => template.active).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS / TRIALS"
        title="Templates"
        description="Reusable missions. A trial snapshots its template when created, so edits here never change a running trial."
        meta={
          <Mono dim>
            {active} active · {templates.length - active} inactive
          </Mono>
        }
        actions={
          <>
            <Link href="/trials" className={buttonStyles({ variant: 'ghost' })}>
              <Icon icon={ArrowLeft} size="sm" />
              Trials
            </Link>
            <ActionButton
              action={seedTemplatesAction}
              label="Install starters"
              icon={PackagePlus}
              data-testid="seed-templates"
            />
            <Link href="/trials/templates/new" className={buttonStyles({ variant: 'primary' })}>
              <Icon icon={Plus} size="sm" />
              New template
            </Link>
          </>
        }
      />
      <Card padding="none">
        {templates.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="NO TEMPLATES"
            description="Install the six curated starters or write your own. Installing never overwrites edited templates."
          />
        ) : (
          <Table caption="Trial templates">
            <TableHead>
              <tr>
                <TableHeaderCell>Template</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Format</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">Rubric</TableHeaderCell>
                <TableHeaderCell className="text-right">State</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} className="relative" data-template={template.key}>
                  <TableCell>
                    <Link
                      href={`/trials/templates/${template.id}`}
                      className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-medium text-fg">{template.title}</span>
                        {seeAdversarial && template.allowsAdversarial ? (
                          <Badge tone="warning">Adversarial allowed</Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-small text-fg-subtle">
                        <Mono dim className="text-[12px]">
                          {template.key}
                        </Mono>
                        <span>· {categoryLabel(template.category)}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Mono dim>
                      {trials.formatDuration(template.durationMinutes)} · teams{' '}
                      {template.teamSizeMin}–{template.teamSizeMax}
                    </Mono>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Mono dim>{template.rubric.length} criteria</Mono>
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge
                      tone={template.active ? 'success' : 'neutral'}
                      quiet={template.active}
                      label={template.active ? 'ACTIVE' : 'INACTIVE'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
