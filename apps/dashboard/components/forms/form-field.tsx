'use client';

import { type ReactElement, type ReactNode, useId } from 'react';
import { Field } from '@jave/ui';
import { useActionFieldError } from './action-form';

export interface FormFieldProps {
  /** Form field name — also the key for inline validation errors. */
  name: string;
  label: ReactNode;
  description?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; name?: string }>;
}

/** Field wired to the enclosing ActionForm: label, description and inline error. */
export function FormField({ name, children, ...rest }: FormFieldProps) {
  const id = `${useId()}-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const error = useActionFieldError(name);
  return (
    <Field id={id} error={error} {...rest}>
      {children}
    </Field>
  );
}
