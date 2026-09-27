'use client';

import { useEffect, useState } from 'react';
import { cx } from '@jave/ui';
import { countdownLabel } from '@/lib/trial-time';

const TICK_MS = 1000;

export interface CountdownProps {
  /** ISO instant being counted down to. */
  target: string;
  /** Server time at render (ms), so the first client render matches the server's. */
  serverNow: number;
  /** Shown once the target has passed. */
  passedLabel: string;
  className?: string;
}

/** A live countdown in the data voice. Announced politely, never every second. */
export function Countdown({ target, serverNow, passedLabel, className }: CountdownProps) {
  const [now, setNow] = useState(serverNow);
  const targetMs = Date.parse(target);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const label = countdownLabel(targetMs - now);
  return (
    <time
      dateTime={target}
      className={cx('type-data tabular-nums', label ? 'text-fg' : 'text-fg-subtle', className)}
    >
      {label ?? passedLabel}
    </time>
  );
}
