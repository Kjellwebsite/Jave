import { useId } from 'react';
import { cx } from '@jave/ui';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  /** Shown but not selectable (the combination cannot work right now). */
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of mutually exclusive choices built on native radios, so keyboard
 * and screen-reader behaviour come from the platform.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx('min-w-0', className)} disabled={disabled}>
      <legend className="type-eyebrow mb-2 text-fg-subtle">{label}</legend>
      <div className="flex w-full rounded-md border border-line-strong bg-surface-sunken p-0.5">
        {options.map((option) => (
          <label key={String(option.value)} className="relative min-w-0 flex-1">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span
              className={cx(
                'type-eyebrow flex h-8 cursor-pointer select-none items-center justify-center rounded-[4px] px-2 text-fg-subtle transition-colors',
                'hover:text-fg-muted peer-checked:bg-surface-overlay peer-checked:text-fg peer-checked:shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
