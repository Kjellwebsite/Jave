'use client';

import type { ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';

export interface CheckboxProps {
  id: string;
  /** Form field name. Checked submits `value` (default `on`). */
  name?: string;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function Checkbox({
  id,
  name,
  value,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
  className,
}: CheckboxProps) {
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <CheckboxPrimitive.Root
        id={id}
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(state) => onCheckedChange?.(state === true)}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface-sunken transition-colors hover:border-fg-faint disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-transparent data-[state=checked]:bg-action data-[state=checked]:text-action-fg"
      >
        <CheckboxPrimitive.Indicator>
          <Icon icon={Check} size="sm" className="size-3" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-body text-fg">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-small text-fg-subtle">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
