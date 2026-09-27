'use client';

import { useId, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { Button, Checkbox, cx, EmptyState, Icon, Input, Mono } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useActionFieldError } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface AssignCandidateView {
  memberId: string;
  displayName: string;
  handle: string;
}

/** The mission service accepts at most this many members per call. */
const MAX_BATCH = 50;
const SEARCH_MAX = 64;

function matches(candidate: AssignCandidateView, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    candidate.displayName.toLowerCase().includes(q) ||
    candidate.handle.toLowerCase().includes(q)
  );
}

function PickerError() {
  const error = useActionFieldError('memberIds');
  return error ? (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  ) : null;
}

function MemberPicker({ candidates }: { candidates: readonly AssignCandidateView[] }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const visible = candidates.filter((candidate) => matches(candidate, query));
  const toggle = (memberId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  if (candidates.length === 0) {
    return (
      <EmptyState
        compact
        title="NOBODY TO ASSIGN"
        description="Every present member in good standing already holds this mission."
      />
    );
  }
  return (
    <div className="space-y-2.5">
      <label className="relative block">
        <span className="sr-only">Search members</span>
        <Icon
          icon={Search}
          size="sm"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          type="search"
          value={query}
          maxLength={SEARCH_MAX}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or handle"
          className="pl-8"
        />
      </label>
      <div className="flex items-center justify-between text-small text-fg-subtle">
        <span>
          {selected.size} selected{selected.size > MAX_BATCH ? ` — at most ${MAX_BATCH}` : ''}
        </span>
        <span>{visible.length} shown</span>
      </div>
      <ul
        aria-label="Members"
        className="max-h-64 divide-y divide-line-subtle overflow-y-auto rounded-md border border-line bg-surface-sunken"
      >
        {candidates.map((candidate) => (
          <li
            key={candidate.memberId}
            className={cx('px-3 py-2.5', !matches(candidate, query) && 'hidden')}
          >
            <Checkbox
              id={`${id}-${candidate.memberId}`}
              name="memberId"
              value={candidate.memberId}
              checked={selected.has(candidate.memberId)}
              onCheckedChange={(checked) => toggle(candidate.memberId, checked)}
              label={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span>{candidate.displayName}</span>
                  <Mono dim className="text-[12px]">
                    @{candidate.handle}
                  </Mono>
                </span>
              }
            />
          </li>
        ))}
      </ul>
      <PickerError />
    </div>
  );
}

/** Assign members to an open mission. The service skips anyone who cannot take it and says why. */
export function AssignDialog({
  missionId,
  headline,
  team,
  candidates,
  action,
}: {
  missionId: string;
  headline: string;
  team: boolean;
  candidates: readonly AssignCandidateView[];
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="MISSIONS"
      title="Assign members"
      description={`${headline}. Members are notified and accept before they start. You cannot assign yourself.`}
      confirmLabel="Assign"
      action={action}
      hidden={{ missionId }}
      trigger={
        <Button variant="primary" iconLeft={UserPlus} data-testid="assign-members">
          Assign
        </Button>
      }
    >
      <MemberPicker candidates={candidates} />
      {team ? (
        <FormField
          name="teamKey"
          label="Team key"
          description="1–32 characters: a–z, 0–9, - or _. Members sharing it submit together."
          required
        >
          <Input name="teamKey" required maxLength={32} placeholder="team-1" mono />
        </FormField>
      ) : null}
      <FormField
        name="durationHours"
        label="Time limit (hours)"
        description="Overrides the mission default for these members. Blank keeps it."
      >
        <Input name="durationHours" type="number" inputMode="numeric" min={1} max={2160} />
      </FormField>
    </ConfirmActionDialog>
  );
}
