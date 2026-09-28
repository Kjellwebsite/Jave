'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Badge, Checkbox, cx, Fieldset, Icon, IconButton, Input, Mono } from '@jave/ui';
import { type MemberOption, type MemberSearch, toggleSelection } from '@/lib/member-search';
import { useActionFieldError } from './action-form';

/** Pause after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;
const QUERY_MAX = 64;

export interface MemberPickerProps {
  /** Hidden input name carrying each picked member id. */
  name: string;
  legend: string;
  description?: string;
  /** Validation issue key for inline errors (defaults to `name`). */
  errorKey?: string;
  search: MemberSearch;
  /** First matches, rendered on the server so the list is never empty on open. */
  initial: readonly MemberOption[];
  /** At most this many picks (1 = a single member). */
  max?: number;
  /** Members who cannot be picked here, with the reason shown in place of the control. */
  unavailable?: Readonly<Record<string, string>>;
  onChange?: (selected: readonly MemberOption[]) => void;
}

function MemberLabel({ member }: { member: MemberOption }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="truncate text-body text-fg">{member.displayName}</span>
      <Mono dim className="truncate text-[12px]">
        @{member.handle}
      </Mono>
    </span>
  );
}

/**
 * Searchable member picker for staff dialogs. The directory is searched on
 * the server (privacy rules apply there); picks survive new searches and are
 * submitted as hidden inputs. The service re-checks every picked member.
 */
export function MemberPicker({
  name,
  legend,
  description,
  errorKey,
  search,
  initial,
  max = 1,
  unavailable = {},
  onChange,
}: MemberPickerProps) {
  const id = useId();
  const error = useActionFieldError(errorKey ?? name);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly MemberOption[]>(initial);
  const [selected, setSelected] = useState<readonly MemberOption[]>([]);
  const [status, setStatus] = useState<{ searching: boolean; message: string | null }>({
    searching: false,
    message: null,
  });
  const latest = useRef(0);
  const single = max === 1;

  useEffect(() => {
    const request = ++latest.current;
    const term = query.trim();
    if (term === '') {
      setResults(initial);
      setStatus({ searching: false, message: null });
      return;
    }
    setStatus({ searching: true, message: null });
    const timer = setTimeout(() => {
      search(term)
        .then((result) => {
          if (request !== latest.current) return;
          if (result.status === 'ok') {
            setResults(result.members);
            setStatus({ searching: false, message: null });
          } else {
            setResults([]);
            setStatus({ searching: false, message: result.message });
          }
        })
        .catch(() => {
          if (request !== latest.current) return;
          setResults([]);
          setStatus({ searching: false, message: 'Search is unavailable. Try again.' });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search, initial]);

  function update(next: readonly MemberOption[]) {
    setSelected(next);
    onChange?.(next);
  }

  function pick(member: MemberOption) {
    update(single ? [member] : toggleSelection(selected, member, max));
  }

  const isSelected = (memberId: string) => selected.some((entry) => entry.memberId === memberId);
  const full = !single && selected.length >= max;

  return (
    <Fieldset legend={legend} description={description}>
      {selected.map((member) => (
        <input key={member.memberId} type="hidden" name={name} value={member.memberId} />
      ))}
      {selected.length > 0 ? (
        <ul aria-label="Selected members" className="flex flex-wrap gap-2">
          {selected.map((member) => (
            <li
              key={member.memberId}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised py-1 pl-2.5 pr-1"
            >
              <MemberLabel member={member} />
              <IconButton
                icon={X}
                size="sm"
                label={`Remove ${member.displayName}`}
                onClick={() =>
                  update(selected.filter((entry) => entry.memberId !== member.memberId))
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
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
          maxLength={QUERY_MAX}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or handle"
          autoComplete="off"
          invalid={Boolean(error)}
          className="pl-8"
        />
      </label>
      <p className="text-small text-fg-subtle" aria-live="polite">
        {status.searching
          ? 'Searching…'
          : (status.message ??
            (single
              ? `${results.length} shown`
              : `${selected.length} selected · at most ${max} · ${results.length} shown`))}
      </p>
      {results.length === 0 && !status.searching && !status.message ? (
        <p className="rounded-md border border-line bg-surface-sunken px-3 py-4 text-center text-small text-fg-subtle">
          No member present in the guild matches.
        </p>
      ) : (
        <ul
          aria-label="Matching members"
          className={cx(
            'max-h-60 divide-y divide-line-subtle overflow-y-auto rounded-md border border-line bg-surface-sunken',
            status.searching && 'opacity-60',
          )}
        >
          {results.map((member) => {
            const reason = unavailable[member.memberId];
            const chosen = isSelected(member.memberId);
            if (reason) {
              return (
                <li key={member.memberId} className="flex items-center gap-3 px-3 py-2.5">
                  {/* Keeps names aligned with the rows that carry a checkbox. */}
                  {single ? null : <span aria-hidden className="size-4 shrink-0" />}
                  <MemberLabel member={member} />
                  <Badge className="ml-auto shrink-0">{reason}</Badge>
                </li>
              );
            }
            if (single) {
              return (
                <li key={member.memberId}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => pick(member)}
                    className={cx(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised',
                      chosen && 'bg-surface-raised',
                    )}
                  >
                    <MemberLabel member={member} />
                    {chosen ? (
                      <Mono className="ml-auto shrink-0 text-[12px] text-fg">SELECTED</Mono>
                    ) : null}
                  </button>
                </li>
              );
            }
            return (
              <li key={member.memberId} className="px-3 py-2.5">
                <Checkbox
                  id={`${id}-${member.memberId}`}
                  checked={chosen}
                  disabled={!chosen && full}
                  onCheckedChange={() => pick(member)}
                  label={<MemberLabel member={member} />}
                />
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </Fieldset>
  );
}
