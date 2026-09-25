import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon, type IconSize } from './icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,filter] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'chrome-plate border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_1px_0_rgb(0_0_0/0.4)] hover:brightness-[1.06] active:brightness-95',
  secondary:
    'border border-line-strong bg-surface-raised text-fg shadow-highlight hover:border-fg-faint hover:bg-surface-overlay active:bg-surface',
  ghost: 'border border-transparent text-fg-muted hover:bg-surface-raised hover:text-fg',
  danger:
    'border border-transparent bg-danger-solid text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-110 active:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-small',
  md: 'h-9 gap-2 px-3.5 text-body',
  lg: 'h-11 gap-2 px-5 text-body',
};

const ICON_ONLY_SIZES: Record<ButtonSize, string> = {
  sm: 'size-7',
  md: 'size-9',
  lg: 'size-11',
};

const ICON_SIZE_FOR: Record<ButtonSize, IconSize> = { sm: 'sm', md: 'md', lg: 'md' };

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Button styling for non-button elements (e.g. links that look like buttons). */
export function buttonStyles({
  variant = 'secondary',
  size = 'md',
  className,
}: ButtonStyleOptions = {}): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and marks it busy. */
  loading?: boolean;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZE_FOR[size];
  const leading = loading ? LoaderCircle : iconLeft;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...rest}
    >
      {leading ? (
        <Icon icon={leading} size={iconSize} className={loading ? 'animate-spin' : undefined} />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon icon={iconRight} size={iconSize} /> : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Required: icon-only controls must have an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BASE, VARIANTS[variant], ICON_ONLY_SIZES[size], className)}
      {...rest}
    >
      <Icon
        icon={loading ? LoaderCircle : icon}
        size={ICON_SIZE_FOR[size]}
        className={loading ? 'animate-spin' : undefined}
      />
    </button>
  );
}
