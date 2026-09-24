import { createServer, type Server } from 'node:http';
import type { HealthReport, Logger } from '@jave/core';

/**
 * Minimal health endpoints for the hosting platform:
 *  GET /healthz — liveness (process is up)
 *  GET /readyz  — readiness (Discord + database + queue); 503 when a critical check is down
 * No other routes; no sensitive data in responses.
 */
export function startHealthServer(options: {
  port: number;
  logger: Logger;
  report: () => Promise<HealthReport>;
}): Server {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') return send(200, { status: 'ok' });
    if (path === '/readyz') {
      options
        .report()
        .then((report) => {
          const checks = report.checks.map((c) => ({
            name: c.name,
            status: c.status,
            latencyMs: c.latencyMs,
          }));
          send(report.status === 'down' ? 503 : 200, {
            status: report.status,
            checks,
            checkedAt: report.checkedAt,
          });
        })
        .catch(() => send(503, { status: 'down' }));
      return;
    }
    send(404, { error: 'not found' });
  });
  server.listen(options.port, () =>
    options.logger.info({ port: options.port }, 'health server listening'),
  );
  return server;
}
