import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';
import type { SelectOption } from './select';

const CONTROL =
  'w-full min-w-0 appearance-none rounded-md border border-line-strong bg-surface-sunken pr-8 text-fg transition-colors hover:border-fg-faint focus-visible:border-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger';

const SIZES = { sm: 'h-8 pl-2.5 text-small', md: 'h-9 pl-3 text-body' } as const;

export interface NativeSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size' | 'children'
> {
  options: readonly SelectOption[];
  size?: keyof typeof SIZES;
  invalid?: boolean;
  /** Leading empty option, e.g. "Any role". Submits an empty string. */
  placeholder?: string;
}

/**
 * A styled native `<select>`. Use it inside plain forms (GET filters, Server
 * Action forms) — it submits without JavaScript and works before hydration.
 * Use `Select` for rich, controlled pickers inside client components.
 */
export function NativeSelect({
  options,
  size = 'md',
  invalid,
  placeholder,
  className,
  ...rest
}: NativeSelectProps) {
  return (
    <span className={cx('relative block min-w-0', className)}>
      <select aria-invalid={invalid || undefined} className={cx(CONTROL, SIZES[size])} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        icon={ChevronDown}
        size="sm"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
    </span>
  );
}
