import { cx } from '../lib/cx';
import { type RoleKey, roleVisual } from '../lib/roles';

export type RoleBadgeSize = 'sm' | 'md';

const SIZES: Record<RoleBadgeSize, string> = {
  sm: 'h-5 px-1.5 text-[10px]',
  md: 'h-6 px-2 text-[11px]',
};

export interface RoleBadgeProps {
  role: RoleKey;
  size?: RoleBadgeSize;
  className?: string;
}

/** Organizational role in its material treatment (holographic founder … neutral member). */
export function RoleBadge({ role, size = 'md', className }: RoleBadgeProps) {
  const visual = roleVisual(role);
  return (
    <span
      data-role={role}
      className={cx(
        'inline-flex shrink-0 items-center rounded-sm font-mono font-medium uppercase leading-none tracking-[0.1em]',
        SIZES[size],
        visual.className,
        className,
      )}
    >
      {visual.label}
    </span>
  );
}
