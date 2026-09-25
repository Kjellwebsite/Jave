'use client';

import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps {
  /** Accessible title; visually hidden when `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  side?: 'left' | 'right';
  children?: ReactNode;
  className?: string;
}

/** Edge-anchored panel (mobile navigation, detail drawers). Focus-trapped like a dialog. */
export function SheetContent({
  title,
  hideTitle = false,
  description,
  side = 'left',
  children,
  className,
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        // Without a description, opt out explicitly (Radix warns otherwise).
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cx(
          'fixed inset-y-0 z-60 flex w-[min(300px,calc(100vw-48px))] flex-col bg-surface shadow-lg focus:outline-none',
          side === 'left'
            ? 'left-0 border-r border-line data-[state=open]:animate-slide-in-left'
            : 'right-0 border-l border-line',
          className,
        )}
      >
        <DialogPrimitive.Title
          className={hideTitle ? 'sr-only' : 'type-eyebrow px-5 pt-5 text-fg-subtle'}
        >
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg"
        >
          <Icon icon={X} />
        </DialogPrimitive.Close>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
