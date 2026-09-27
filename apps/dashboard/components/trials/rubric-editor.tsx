'use client';

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, Mono, Textarea } from '@jave/ui';
import { useActionFieldError } from '../forms/action-form';

export interface RubricCriterionValue {
  key: string;
  label: string;
  description: string;
  weight: number;
}

interface Row extends RubricCriterionValue {
  /** Stable React key; never submitted. */
  uid: number;
  /** The key was typed by hand: stop deriving it from the label. */
  keyEdited: boolean;
}

/** Mirrors the service limits; the service validates again. */
export const RUBRIC_LIMITS = {
  minCriteria: 1,
  maxCriteria: 10,
  maxWeight: 100,
  keyLength: 48,
  labelLength: 60,
  descriptionLength: 400,
} as const;

const DEFAULT_WEIGHT = 1;
const PERCENT = 100;
const KEY_FALLBACK_PREFIX = 'c_';
const MIN_KEY_LENGTH = 2;

/** "User value (live)" → "user_value_live". */
export function criterionKeyFromLabel(label: string): string {
  let key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(key)) key = `${KEY_FALLBACK_PREFIX}${key}`;
  if (key.length < MIN_KEY_LENGTH) key = `${key}_1`;
  return key.slice(0, RUBRIC_LIMITS.keyLength);
}

function toRows(criteria: readonly RubricCriterionValue[]): Row[] {
  return criteria.map((criterion, index) => ({ ...criterion, uid: index, keyEdited: true }));
}

export interface RubricEditorProps {
  /** Form field that carries the rubric as JSON. */
  name: string;
  initial: readonly RubricCriterionValue[];
  /** Changing this key re-seeds the rows (e.g. a template was picked). */
  seedKey?: string;
}

/**
 * Rubric criteria with relative weights. Each weight's share of the total is
 * shown live; the result is submitted as one JSON field and validated by the
 * trials service (keys, lengths, 1–10 criteria, weights > 0).
 */
export function RubricEditor({ name, initial, seedKey = '' }: RubricEditorProps) {
  const baseId = useId();
  const error = useActionFieldError(name);
  const [seed, setSeed] = useState(seedKey);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [nextUid, setNextUid] = useState(initial.length);

  if (seed !== seedKey) {
    setSeed(seedKey);
    setRows(toRows(initial));
    setNextUid(initial.length);
  }

  const totalWeight = rows.reduce(
    (sum, row) => sum + (Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 0),
    0,
  );
  const serialized = JSON.stringify(
    rows.map(({ key, label, description, weight }) => ({ key, label, description, weight })),
  );

  function update(uid: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => {
        if (row.uid !== uid) return row;
        const next = { ...row, ...patch };
        if (patch.label !== undefined && !row.keyEdited)
          next.key = criterionKeyFromLabel(patch.label);
        return next;
      }),
    );
  }

  function move(index: number, delta: number) {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function add() {
    setRows((current) => [
      ...current,
      { uid: nextUid, key: '', label: '', description: '', weight: DEFAULT_WEIGHT, keyEdited: false },
    ]);
    setNextUid((uid) => uid + 1);
  }

  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={error ? `${baseId}-error` : undefined}>
      <legend className="text-small font-medium text-fg-muted">
        Rubric<span aria-hidden className="ml-1 text-fg-subtle">*</span>
      </legend>
      <p className="-mt-1.5 text-small text-fg-subtle">
        Evaluators score every criterion 0–10. Weights are relative; the share of each is shown.
        Measure outcomes, never effort.
      </p>
      <input type="hidden" name={name} value={serialized} />
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const share =
            totalWeight > 0 && row.weight > 0 ? Math.round((row.weight / totalWeight) * PERCENT) : 0;
          const id = `${baseId}-${row.uid}`;
          return (
            <li
              key={row.uid}
              data-criterion={index}
              className="rounded-md border border-line bg-surface-sunken/40 p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_112px]">
                <div className="min-w-0 space-y-1.5">
                  <label htmlFor={`${id}-label`} className="text-small font-medium text-fg-muted">
                    Criterion {index + 1}
                  </label>
                  <Input
                    id={`${id}-label`}
                    value={row.label}
                    onChange={(event) => update(row.uid, { label: event.target.value })}
                    maxLength={RUBRIC_LIMITS.labelLength}
                    placeholder="Working product"
                    required
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <label htmlFor={`${id}-weight`} className="text-small font-medium text-fg-muted">
                    Weight
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${id}-weight`}
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={RUBRIC_LIMITS.maxWeight}
                      step="any"
                      value={Number.isFinite(row.weight) ? row.weight : ''}
                      onChange={(event) => update(row.uid, { weight: event.target.valueAsNumber })}
                      className="w-20"
                      mono
                      required
                    />
                    <Mono dim aria-label={`${share} percent`} data-testid="criterion-share">
                      {share}%
                    </Mono>
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <label htmlFor={`${id}-description`} className="text-small font-medium text-fg-muted">
                  What earns a 10
                </label>
                <Textarea
                  id={`${id}-description`}
                  value={row.description}
                  onChange={(event) => update(row.uid, { description: event.target.value })}
                  maxLength={RUBRIC_LIMITS.descriptionLength}
                  rows={2}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2 text-small text-fg-subtle">
                  <span className="type-eyebrow">KEY</span>
                  <Input
                    size="sm"
                    mono
                    value={row.key}
                    onChange={(event) =>
                      update(row.uid, { key: event.target.value, keyEdited: true })
                    }
                    maxLength={RUBRIC_LIMITS.keyLength}
                    aria-label={`Criterion ${index + 1} key`}
                    className="w-48 max-w-full"
                    spellCheck={false}
                  />
                </label>
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={ArrowUp}
                    size="sm"
                    label={`Move criterion ${index + 1} up`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="sm"
                    label={`Move criterion ${index + 1} down`}
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                  />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={`Remove criterion ${index + 1}`}
                    onClick={() => setRows((current) => current.filter((r) => r.uid !== row.uid))}
                    disabled={rows.length <= RUBRIC_LIMITS.minCriteria}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Plus}
          onClick={add}
          disabled={rows.length >= RUBRIC_LIMITS.maxCriteria}
        >
          Add criterion
        </Button>
        <Mono dim>
          {rows.length}/{RUBRIC_LIMITS.maxCriteria} criteria
        </Mono>
      </div>
      {error ? (
        <p id={`${baseId}-error`} role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
