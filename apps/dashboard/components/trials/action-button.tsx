'use client';

import type { LucideIcon } from 'lucide-react';
import { Button, type ButtonVariant } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useToastedAction } from '../toast';

export interface ActionButtonProps {
  action: FormAction;
  label: string;
  /** Identifiers the action needs (validated and authorized server-side). */
  hidden?: Record<string, string>;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
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
      iconLeft={icon}
      loading={pending}
      onClick={submit}
      data-testid={testId}
    >
      {label}
    </Button>
  );
}
