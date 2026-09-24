'use client';

import type { ReactNode } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cx } from '../lib/cx';

export interface SwitchProps {
  id: string;
  /** Form field name. When checked the form carries `on`; unchecked omits the field. */
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** A labeled on/off setting. The whole row is the hit target. */
export function Switch({
  id,
  name,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
  className,
}: SwitchProps) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
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
      <SwitchPrimitive.Root
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong bg-surface-sunken transition-colors disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-transparent data-[state=checked]:bg-action"
      >
        <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg-subtle shadow-sm transition-[translate,background-color] data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-action-fg" />
      </SwitchPrimitive.Root>
    </div>
  );
}
