'use client';

import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@jave/ui';

/** Submit button that shows the enclosing form's pending state. */
export function SubmitButton({ children, ...rest }: Omit<ButtonProps, 'type' | 'loading'>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {children}
    </Button>
  );
}
