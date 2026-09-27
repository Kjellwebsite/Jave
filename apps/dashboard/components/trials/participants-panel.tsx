'use client';

import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect } from 'react';
import Link from 'next/link';
import { Shuffle, UsersRound } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Mono,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import {
  PARTICIPANT_STATUS_LABELS,
  PARTICIPANT_STATUS_TONE,
  type ParticipantStatusKey,
} from '@/lib/trial-labels';
import { ActionFeedback, type FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { useToast } from '../toast';
import { IDLE_STATE } from '@/lib/action-state';

export interface ParticipantRow {
  memberId: string;
  displayName: string;
  handle: string;
  status: ParticipantStatusKey;
  teamName: string | null;
  lead: boolean;
  statement: string | null;
  appliedAt: string;
}

export interface ParticipantsPanelProps {
  trialId: string;
  rows: readonly ParticipantRow[];
  /** Recruiting and the viewer manages trials: selection controls are shown. */
  selectable: boolean;
  maxParticipants: number | null;
  randomAction: FormAction;
  manualAction: FormAction;
}

/** Who may be (re)selected: applicants, the current selection and the waitlist. */
const POOL: readonly ParticipantStatusKey[] = ['applied', 'selected', 'waitlisted'];
const SEED_MAX = 64;

function Statement({ text }: { text: string | null }) {
  if (!text) return <span className="text-fg-faint">—</span>;
  return (
    <details className="group max-w-md">
      <summary className="cursor-pointer list-none text-small text-fg-muted [&::-webkit-details-marker]:hidden">
        <span className="line-clamp-2 group-open:line-clamp-none whitespace-pre-wrap break-words">
          {text}
        </span>
      </summary>
    </details>
  );
}

function StatusCell({ row }: { row: ParticipantRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge
        tone={PARTICIPANT_STATUS_TONE[row.status]}
        quiet={row.status === 'selected'}
        label={PARTICIPANT_STATUS_LABELS[row.status].toUpperCase()}
      />
      {row.teamName ? (
        <Mono dim className="text-[12px]">
          {row.teamName}
          {row.lead ? ' · lead' : ''}
        </Mono>
      ) : null}
    </span>
  );
}

/** The checkbox table as one form: the checked set replaces the selection. */
function SelectionForm({
  action,
  trialId,
  children,
}: {
  action: FormAction;
  trialId: string;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const toast = useToast();
  useEffect(() => {
    if (state.status === 'success') toast(state.message);
  }, [state, toast]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form action={dispatch} onSubmit={handleSubmit} aria-label="Manual selection" aria-busy={pending || undefined}>
      <input type="hidden" name="trialId" value={trialId} />
      <fieldset disabled={pending} className="min-w-0">
        {children}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-5 py-3">
        {state.status === 'error' ? (
          <ActionFeedback state={state} className="min-w-0 flex-1" />
        ) : (
          <Badge tone="neutral">Replaces the current selection</Badge>
        )}
        <Button type="submit" variant="primary" loading={pending} data-testid="save-selection">
          Save selection
        </Button>
      </div>
    </form>
  );
}

/**
 * Applicants and their status. While recruiting, trial managers select
 * participants here — by hand (the checked set replaces the selection) or
 * by a seeded random draw. Eligibility is re-checked by the service.
 */
export function ParticipantsPanel({
  trialId,
  rows,
  selectable,
  maxParticipants,
  randomAction,
  manualAction,
}: ParticipantsPanelProps) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon={UsersRound}
        title="NO APPLICANTS YET"
        description="Applications arrive through the recruitment card in Discord once recruitment is open."
      />
    );
  const pool = rows.filter((row) => POOL.includes(row.status));
  const selected = rows.filter((row) => row.status === 'selected').length;

  const table = (
    <Table caption="Participants">
      <TableHead>
        <tr>
          <TableHeaderCell>Member</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">Status</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">Statement</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell text-right">Applied</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => {
          const choosable = selectable && POOL.includes(row.status);
          return (
            <TableRow key={row.memberId} data-participant={row.handle}>
              <TableCell>
                {choosable ? (
                  <Checkbox
                    id={`pick-${row.memberId}`}
                    name="memberIds"
                    value={row.memberId}
                    defaultChecked={row.status === 'selected'}
                    label={row.displayName}
                    description={`@${row.handle}`}
                  />
                ) : (
                  <span className="block min-w-0">
                    <Link
                      href={`/members/${row.memberId}`}
                      className="text-body font-medium text-fg hover:underline"
                    >
                      {row.displayName}
                    </Link>
                    <span className="type-data block text-[12px] text-fg-subtle">
                      @{row.handle}
                    </span>
                  </span>
                )}
                <span className="mt-2 block sm:hidden">
                  <StatusCell row={row} />
                </span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusCell row={row} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Statement text={row.statement} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
                <Mono dim>{row.appliedAt}</Mono>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  if (!selectable) return table;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <p className="text-small text-fg-subtle">
          <Mono className="text-fg">{selected}</Mono> selected of{' '}
          <Mono className="text-fg">{pool.length}</Mono> in the pool
          {maxParticipants ? (
            <>
              {' '}
              · cap <Mono className="text-fg">{maxParticipants}</Mono>
            </>
          ) : null}
          . Check who competes, then save. Unchecked applicants return to the pool.
        </p>
        <ConfirmActionDialog
          eyebrow="SELECTION"
          title="Random selection"
          description="Draws from eligible applicants and replaces the current selection. The seed is recorded; the same seed reproduces the draw."
          confirmLabel="Draw participants"
          action={randomAction}
          hidden={{ trialId }}
          trigger={
            <Button iconLeft={Shuffle} data-testid="random-selection">
              Random draw
            </Button>
          }
        >
          <FormField name="count" label="How many" required>
            <Input
              name="count"
              type="number"
              inputMode="numeric"
              min={1}
              max={pool.length || 1}
              defaultValue={Math.min(pool.length, maxParticipants ?? pool.length)}
              required
              mono
            />
          </FormField>
          <FormField name="seed" label="Seed" description="Optional. Letters, digits and . _ : -">
            <Input name="seed" maxLength={SEED_MAX} mono spellCheck={false} />
          </FormField>
        </ConfirmActionDialog>
      </div>
      <SelectionForm action={manualAction} trialId={trialId}>
        {table}
      </SelectionForm>
    </div>
  );
}
