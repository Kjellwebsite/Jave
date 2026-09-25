import { BadgeCheck } from 'lucide-react';
import { cx, Icon } from '@jave/ui';

/** VERIFIED member mark: brushed chrome, the same material as verified ranks. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'rank-verified type-eyebrow inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[10px] leading-none',
        className,
      )}
    >
      <Icon icon={BadgeCheck} size="sm" className="size-3" />
      VERIFIED
    </span>
  );
}
