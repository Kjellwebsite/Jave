import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface FieldProps {
  /** Id of the control; description and error ids derive from it. */
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Visually hide the label (it stays available to assistive tech). */
  hideLabel?: boolean;
  className?: string;
  /** The control. Receives id, aria-describedby and aria-invalid. */
  children: ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    invalid?: boolean;
  }>;
}

export function fieldDescriptionId(id: string): string {
  return `${id}-description`;
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/** Label, control, description and error, wired for assistive technology. */
export function Field({
  id,
  label,
  description,
  error,
  required,
  hideLabel,
  className,
  children,
}: FieldProps) {
  const describedBy =
    [description ? fieldDescriptionId(id) : null, error ? fieldErrorId(id) : null]
      .filter(Boolean)
      .join(' ') || undefined;
  // Components (Input, Select…) take `invalid`; plain DOM elements take aria-invalid.
  const invalid = Boolean(error) || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        ...(typeof children.type === 'string' ? { 'aria-invalid': invalid } : { invalid }),
      })
    : children;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cx('text-small font-medium text-fg-muted', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-fg-subtle">
            *
          </span>
        ) : null}
      </label>
      {control}
      {description ? (
        <p id={fieldDescriptionId(id)} className="text-small text-fg-subtle">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={fieldErrorId(id)} role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface FieldsetProps {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Groups related controls (checkbox lists, time ranges) under one legend. */
export function Fieldset({ legend, description, children, className }: FieldsetProps) {
  return (
    <fieldset className={cx('min-w-0 space-y-3', className)}>
      <legend className="text-small font-medium text-fg-muted">{legend}</legend>
      {description ? <p className="-mt-1.5 text-small text-fg-subtle">{description}</p> : null}
      {children}
    </fieldset>
  );
}
