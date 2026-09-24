import { NextResponse } from 'next/server';
import { runHealthChecks } from '@jave/core';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const SERVICE_UNAVAILABLE = 503;

/**
 * Liveness + database readiness. Public, so it reports states and latencies
 * only — never error details, hosts or versions.
 */
export async function GET(): Promise<NextResponse> {
  const report = await runHealthChecks([
    {
      name: 'database',
      critical: true,
      run: async () => ({ status: 'ok', latencyMs: await getRuntime().database.ping() }),
    },
  ]);
  return NextResponse.json(
    {
      service: 'jave-dashboard',
      status: report.status,
      checkedAt: report.checkedAt,
      checks: report.checks.map(({ name, status, latencyMs }) => ({ name, status, latencyMs })),
    },
    {
      status: report.status === 'down' ? SERVICE_UNAVAILABLE : 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
