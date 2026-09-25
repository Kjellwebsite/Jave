'use client';

import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cx } from '../lib/cx';
import { initials } from '../lib/format';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-[11px]',
  lg: 'size-10 text-small',
  xl: 'size-16 text-heading',
  '2xl': 'size-24 text-title',
};

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

/** Squared, machined avatar with an initials fallback while loading or on error. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cx(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-md border border-line bg-surface-raised',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 400 : 0}
        className="font-mono font-medium tracking-wider text-fg-muted"
        aria-label={name}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
