'use client';

import type { ComponentProps } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cx } from '../lib/cx';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cx(
        'flex max-w-full items-end gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]',
        className,
      )}
      {...rest}
    />
  );
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cx(
        'type-eyebrow relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b border-transparent px-3 text-fg-subtle transition-colors hover:text-fg-muted',
        'data-[state=active]:border-fg data-[state=active]:text-fg',
        className,
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cx('pt-6 focus-visible:outline-offset-4', className)}
      {...rest}
    />
  );
}
