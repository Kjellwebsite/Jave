import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

const CONTROL =
  'w-full min-w-0 rounded-md border border-line-strong bg-surface-sunken text-fg transition-colors placeholder:text-fg-faint hover:border-fg-faint focus-visible:border-focus disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-surface read-only:hover:border-line-strong aria-invalid:border-danger';

const INPUT_SIZES = { sm: 'h-8 px-2.5 text-small', md: 'h-9 px-3 text-body' } as const;

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof INPUT_SIZES;
  invalid?: boolean;
  /** Render the value in Geist Mono (IDs, codes, numbers). */
  mono?: boolean;
}

export function Input({ size = 'md', invalid, mono, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, INPUT_SIZES[size], mono && 'font-mono', className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'min-h-20 resize-y px-3 py-2 text-body leading-relaxed', className)}
      {...rest}
    />
  );
}
