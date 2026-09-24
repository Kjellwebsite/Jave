import type { LucideIcon } from 'lucide-react';
import { ICON_STROKE_WIDTH, iconSizes } from '../tokens';
import { cx } from '../lib/cx';

export type IconSize = keyof typeof iconSizes;

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
  /** Accessible name. Omit for decorative icons (the default). */
  label?: string;
}

/** Every icon goes through here: one stroke weight, three sizes. */
export function Icon({ icon: Glyph, size = 'md', className, label }: IconProps) {
  return (
    <Glyph
      size={iconSizes[size]}
      strokeWidth={ICON_STROKE_WIDTH}
      className={cx('shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
