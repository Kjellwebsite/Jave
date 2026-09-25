import Link from 'next/link';
import { Emblem, Wordmark } from '@jave/ui';

/** Emblem + wordmark, linking home. */
export function BrandLockup() {
  return (
    <Link
      href="/overview"
      aria-label="JAVELIN — overview"
      className="flex items-center gap-3 rounded-md px-2 py-1.5"
    >
      <Emblem size="md" />
      <span className="flex flex-col gap-1.5">
        <Wordmark size="sm" />
        <span className="type-eyebrow text-[10px] text-fg-subtle">OPERATIONS</span>
      </span>
    </Link>
  );
}
