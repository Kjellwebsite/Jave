export type HealthState = 'ok' | 'degraded' | 'down' | 'disabled';

export interface HealthResult {
  name: string;
  status: HealthState;
  latencyMs?: number;
  detail?: string;
}

export interface HealthCheck {
  name: string;
  /** Critical checks turn the overall status to `down`; others only degrade it. */
  critical: boolean;
  run: () => Promise<Omit<HealthResult, 'name'>>;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checks: HealthResult[];
  checkedAt: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run checks concurrently with a per-check timeout. Never throws. */
export async function runHealthChecks(
  checks: readonly HealthCheck[],
  timeoutMs = 3000,
): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (check): Promise<HealthResult & { critical: boolean }> => {
      const started = performance.now();
      try {
        const result = await withTimeout(check.run(), timeoutMs);
        return {
          name: check.name,
          critical: check.critical,
          latencyMs: Math.round(performance.now() - started),
          ...result,
        };
      } catch (error) {
        return {
          name: check.name,
          critical: check.critical,
          status: 'down',
          latencyMs: Math.round(performance.now() - started),
          detail: error instanceof Error ? error.message : 'check failed',
        };
      }
    }),
  );
  const criticalDown = results.some((r) => r.critical && r.status === 'down');
  const anyProblem = results.some((r) => r.status === 'down' || r.status === 'degraded');
  return {
    status: criticalDown ? 'down' : anyProblem ? 'degraded' : 'ok',
    checks: results.map(({ critical: _critical, ...rest }) => rest),
    checkedAt: new Date().toISOString(),
  };
}
