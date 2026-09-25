'use client';

import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';

export interface SelectOption {
  /** Radix forbids the empty string; use a sentinel such as `all`. */
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  /** Form field name: a hidden native select carries the value in form submissions. */
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

const TRIGGER_SIZES = { sm: 'h-8 text-small', md: 'h-9 text-body' } as const;

export function Select({
  options,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select…',
  disabled,
  required,
  invalid,
  size = 'md',
  className,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      required={required}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cx(
          'inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-sunken px-3 text-left text-fg transition-colors hover:border-fg-faint disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-[placeholder]:text-fg-subtle',
          TRIGGER_SIZES[size],
          className,
        )}
        {...aria}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <Icon icon={ChevronDown} size="sm" className="text-fg-subtle" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="machined relative z-70 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-overlay shadow-lg data-[state=open]:animate-rise-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-8 cursor-default select-none items-center rounded-md pl-7 pr-3 text-body text-fg-muted outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-raised data-[highlighted]:text-fg"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Icon icon={Check} size="sm" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
