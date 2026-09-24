import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatCount } from '../lib/format';
import { type LinkComponent, PlainLink } from '../lib/link';

export interface StatProps {
  label: string;
  /** Numbers are grouped and set in Orbitron numerals; strings render as given. */
  value: number | string | null;
  /** One line of context: a window ("last 7 days") or a comparison. */
  hint?: ReactNode;
  href?: string;
  linkComponent?: LinkComponent;
  className?: string;
}

/** An instrument readout: eyebrow label, large numeral, quiet hint. */
export function Stat({
  label,
  value,
  hint,
  href,
  linkComponent: Link = PlainLink,
  className,
}: StatProps) {
  const display = typeof value === 'number' || value === null ? formatCount(value) : value;
  const body = (
    <>
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="type-numeral mt-3 text-fg">{display}</dd>
      {hint ? <dd className="mt-1.5 text-small text-fg-subtle">{hint}</dd> : null}
    </>
  );
  const frame = 'relative block rounded-lg border border-line bg-surface p-5 machined';
  if (href) {
    return (
      <Link
        href={href}
        className={cx(
          frame,
          'transition-colors hover:border-line-strong hover:bg-surface-raised',
          className,
        )}
      >
        <dl>{body}</dl>
      </Link>
    );
  }
  return <dl className={cx(frame, className)}>{body}</dl>;
}
