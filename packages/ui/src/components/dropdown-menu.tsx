'use client';

import type { ComponentProps } from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { cx } from '../lib/cx';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...rest
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cx(
          'machined relative z-70 min-w-52 rounded-lg border border-line bg-surface-overlay p-1 shadow-lg data-[state=open]:animate-rise-in',
          className,
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...rest
}: ComponentProps<typeof MenuPrimitive.Item> & { tone?: 'default' | 'danger' }) {
  return (
    <MenuPrimitive.Item
      className={cx(
        'flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-body outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        tone === 'danger'
          ? 'text-danger data-[highlighted]:bg-danger/10'
          : 'text-fg-muted data-[highlighted]:bg-surface-raised data-[highlighted]:text-fg',
        className,
      )}
      {...rest}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cx('type-eyebrow px-2.5 pb-1 pt-2 text-fg-subtle', className)}
      {...rest}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cx('my-1 h-px bg-line', className)} {...rest} />;
}
