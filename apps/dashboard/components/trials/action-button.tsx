'use client';

import { PackagePlus, RefreshCw } from 'lucide-react';
import { Button, type ButtonVariant } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useToastedAction } from '../toast';

/**
 * Icons by name: a Server Component cannot hand a component (a function) to
 * this Client Component, so it names one instead.
 */
const ACTION_ICONS = { install: PackagePlus, resync: RefreshCw } as const;
export type ActionIcon = keyof typeof ACTION_ICONS;

export interface ActionButtonProps {
  action: FormAction;
  label: string;
  /** Identifiers the action needs (validated and authorized server-side). */
  hidden?: Record<string, string>;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ActionIcon;
  'data-testid'?: string;
}

/**
 * A one-click Server Action for low-stakes, repeatable operations (install
 * starters, re-sync channels). Every result is announced as a toast in its
 * own tone — success, or a refusal with its reference. Consequential
 * actions use ConfirmActionDialog instead.
 */
export function ActionButton({
  action,
  label,
  hidden = {},
  variant = 'secondary',
  size = 'md',
  icon,
  'data-testid': testId,
}: ActionButtonProps) {
  const { run, pending } = useToastedAction(action);

  function submit() {
    const data = new FormData();
    for (const [name, value] of Object.entries(hidden)) data.set(name, value);
    run(data);
  }

  return (
    <Button
      variant={variant}
      size={size}
      iconLeft={icon ? ACTION_ICONS[icon] : undefined}
      loading={pending}
      onClick={submit}
      data-testid={testId}
    >
      {label}
    </Button>
  );
}
