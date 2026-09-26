import { useEffect, useState } from 'react';
import type { ServerClock } from '../api/session';

/** Re-renders every `intervalMs` with the current server time (for countdowns). */
export function useServerNow(clock: ServerClock, intervalMs: number): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [clock, intervalMs]);
  return now;
}
