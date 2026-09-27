'use client';

import type { ReactNode } from 'react';
import { NativeSelect } from '@jave/ui';
import { FormField } from './form-field';

export interface SelectFieldProps {
  name: string;
  label: ReactNode;
  description?: ReactNode;
  required?: boolean;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  /** Leading empty option; submits an empty string. */
  placeholder?: string;
}

/**
 * A labelled NativeSelect for Server Components. FormField wires its label to
 * the control by cloning the child element; a NativeSelect created in a
 * Server Component reaches it already rendered (its outer wrapper), so the id
 * would land on the wrapper and the label would name nothing. Created here,
 * on the client, the id reaches the `<select>` itself.
 */
export function SelectField({
  name,
  label,
  description,
  required,
  options,
  defaultValue,
  placeholder,
}: SelectFieldProps) {
  return (
    <FormField name={name} label={label} description={description} required={required}>
      <NativeSelect
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        options={options}
      />
    </FormField>
  );
}
