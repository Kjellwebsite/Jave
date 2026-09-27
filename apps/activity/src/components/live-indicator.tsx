import { cx } from '@jave/ui';
import type { Connection } from '../hooks/use-arena';

const LABEL: Record<Connection, string> = {
  connecting: 'CONNECTING',
  live: 'ONLINE',
  reconnecting: 'RECONNECTING',
};

const DOT: Record<Connection, string> = {
  connecting: 'bg-fg-faint',
  live: 'bg-success',
  reconnecting: 'bg-warning animate-pulse',
};

/** Connection state of the Arena link, announced politely when it changes. */
export function LiveIndicator({ connection }: { connection: Connection }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx(
        'type-eyebrow inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5',
        connection === 'reconnecting' ? 'text-warning' : 'text-fg-subtle',
      )}
    >
      <span aria-hidden className={cx('size-1.5 rounded-full', DOT[connection])} />
      {LABEL[connection]}
    </span>
  );
}
