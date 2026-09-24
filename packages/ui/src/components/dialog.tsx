'use client';

import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogSize = 'sm' | 'md' | 'lg';

const WIDTHS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export interface DialogContentProps {
  title: ReactNode;
  /** Required for context; screen readers announce it with the title. */
  description: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  className?: string;
}

export function DialogContent({
  title,
  description,
  eyebrow,
  children,
  footer,
  size = 'md',
  className,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cx(
          'machined fixed left-1/2 top-1/2 z-60 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface-overlay shadow-lg focus:outline-none data-[state=open]:animate-rise-in',
          WIDTHS[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0 space-y-1">
            {eyebrow ? <p className="type-eyebrow text-fg-subtle">{eyebrow}</p> : null}
            <DialogPrimitive.Title className="type-heading text-fg">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-small text-fg-subtle">
              {description}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <Icon icon={X} />
          </DialogPrimitive.Close>
        </div>
        {children ? <div className="min-h-0 overflow-y-auto px-5 py-5">{children}</div> : null}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
