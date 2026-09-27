import type { ReactNode } from 'react';
import { cx } from '@jave/ui';

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Label/value readout rows (eyebrow label left, value right), hairline-separated. */
export function FactList({ facts, className }: { facts: readonly Fact[]; className?: string }) {
  return (
    <dl className={cx('divide-y divide-line-subtle', className)}>
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="type-eyebrow shrink-0 pt-0.5 text-fg-subtle">{fact.label}</dt>
          <dd className="min-w-0 break-words text-right text-small text-fg-muted">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
