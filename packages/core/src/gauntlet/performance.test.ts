import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testBackend } from '@jave/database/testing';
import { listAiRequests, getUsageByUser } from '../ai/requests.service';
import { getOrgUsage, getUsage } from '../ai/usage.service';
import { getServerOverview } from '../analytics/overview.service';
import { getJavelinProgress } from '../analytics/progress.service';
import { listAuditLogs } from '../audit/audit.service';
import { getProfile } from '../identity/profile.service';
import { listMembers } from '../identity/users.service';
import { listJobs } from '../jobs/admin.service';
import { claimJobs, getQueueStats } from '../jobs/queue';
import type { ServiceContext } from '../kernel/context';
import { listMyNotifications } from '../notifications/notifications.service';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';

/**
 * GAUNTLET: hot paths at realistic scale, on real Postgres only (PGlite has
 * no comparable planner or buffer cache). Seeds hundreds of thousands of
 * rows, captures the SQL the services really run, and EXPLAINs each
 * statement: no sequential scan may touch a table that grows without bound,
 * and every read stays within a generous time budget. Run with
 * JAVE_TEST_BACKEND=postgres; skipped otherwise.
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const MEMBERS = 20_000;
const NOTIFICATIONS = 300_000;
const FOCUS_NOTIFICATIONS = 5_000;
const AUDIT_ENTRIES = 300_000;
const COMPLETED_JOBS = 200_000;
const DUE_JOBS = 1_000;
const DEAD_JOBS = 500;
const DOMAIN_EVENTS = 300_000;
const AI_REQUESTS = 300_000;
const FOCUS_AI_REQUESTS = 2_000;
/** One request in this many is a mission draft: a rare feature filter. */
const RARE_AI_FEATURE_EVERY = 1_000;
/** One request in this many failed: a rare status filter. */
const AI_ERROR_EVERY = 200;

/** Tables that grow with activity, not with membership: never scan them whole. */
const UNBOUNDED_TABLES = new Set([
  'notifications',
  'notification_deliveries',
  'audit_logs',
  'jobs',
  'domain_events',
  'ai_requests',
]);

/** Budget for one hot read, generous so a loaded machine does not flake it. */
const READ_BUDGET_MS = 250;
/**
 * Rows one sequential scan of an unbounded table may read. A capped count
 * stops after COUNT_CAP + 1 matches (for a common filter Postgres reads
 * about cap / selectivity rows, ~50k here); a full scan reads every seeded
 * row (300k). The budget sits between the two.
 */
const SCAN_BUDGET_ROWS = 100_000;

interface CapturedStatement {
  label: string;
  sql: string;
  params: unknown[];
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

interface SeqScan {
  table: string;
  rows: number;
}

interface PlanReport {
  label: string;
  kind: 'read' | 'write';
  executionMs: number | null;
  seqScans: SeqScan[];
}

/** Rows a scan read: returned plus filtered out, per loop (estimated when not executed). */
function rowsRead(node: PlanNode): number {
  if (node['Actual Rows'] === undefined) return node['Plan Rows'] ?? 0;
  const perLoop = node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0);
  return perLoop * (node['Actual Loops'] ?? 1);
}

function collectSeqScans(node: PlanNode, into: SeqScan[]): SeqScan[] {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'])
    into.push({ table: node['Relation Name'], rows: rowsRead(node) });
  for (const child of node.Plans ?? []) collectSeqScans(child, into);
  return into;
}

const isRead = (sql: string) =>
  /^\s*(select|with)\b/i.test(sql) && !/\b(update|insert|delete)\b/i.test(sql);

describe.skipIf(testBackend() !== 'postgres')(
  'GAUNTLET: hot paths at scale (real Postgres)',
  () => {
    let kit: TestKit;
    let founder: UserActor;
    let focus: UserActor;
    let captured: CapturedStatement[];

    beforeAll(async () => {
      kit = await createTestKit();
      founder = await kit.member({ roles: ['founder'], username: 'perf_founder' });
      focus = await kit.member({ roles: ['verified'], username: 'perf_focus' });
      const q = kit.database.exec;
      await q(`
      insert into users (discord_id, username)
      select (300000000000000000 + g)::text, 'perf_user_' || g from generate_series(1, ${MEMBERS}) g;
      insert into members (user_id, handle, display_name, guild_status, joined_guild_at)
      select u.id, 'perf_' || substr(u.username, 11), 'Perf ' || substr(u.username, 11), 'present',
             now() - (random() * interval '400 days')
      from users u where u.username like 'perf_user_%';
    `);
      await q(`
      with ids as (select array_agg(id) a from users where username like 'perf_user_%')
      insert into notifications (recipient_user_id, type, title, body, created_at)
      select ids.a[1 + g % ${MEMBERS}], 'system.announcement', 'NOTICE', 'Seeded notification.',
             now() - (g * interval '10 seconds')
      from generate_series(1, ${NOTIFICATIONS}) g, ids;
      insert into notifications (recipient_user_id, type, title, body, created_at)
      select '${focus.userId}', 'system.announcement', 'NOTICE', 'Seeded notification.',
             now() - (g * interval '1 minute')
      from generate_series(1, ${FOCUS_NOTIFICATIONS}) g;
    `);
      await q(`
      with ids as (select array_agg(id) a from users where username like 'perf_user_%')
      insert into audit_logs (actor_type, actor_user_id, action, target_type, target_id, created_at)
      select 'user', ids.a[1 + g % ${MEMBERS}],
             (array['member.updated','ticket.claimed','application.reviewed','role.granted','settings.updated'])[1 + g % 5],
             'member', (g % 5000)::text, now() - (g * interval '5 seconds')
      from generate_series(1, ${AUDIT_ENTRIES}) g, ids;
    `);
      await q(`
      insert into jobs (type, status, run_at, created_at, completed_at, attempts)
      select 'perf.noop', 'completed', now() - (g * interval '2 seconds'), now() - (g * interval '2 seconds'),
             now() - (g * interval '2 seconds'), 1
      from generate_series(1, ${COMPLETED_JOBS}) g;
      insert into jobs (type, status, run_at, created_at)
      select 'perf.noop', 'pending', now() - interval '1 minute', now() - interval '1 minute'
      from generate_series(1, ${DUE_JOBS}) g;
      insert into jobs (type, status, run_at, created_at, completed_at, attempts, last_error)
      select 'perf.noop', 'dead', now() - (g * interval '1 hour'), now() - (g * interval '1 hour'),
             now() - (g * interval '1 hour'), 5, 'seeded failure'
      from generate_series(1, ${DEAD_JOBS}) g;
    `);
      await q(`
      with ids as (select array_agg(id) a from members where handle like 'perf_%')
      insert into domain_events (type, aggregate_type, aggregate_id, subject_member_id, occurred_at)
      select (array['mission.completed','project.created','contribution.verified','trial.passed'])[1 + g % 4],
             'member', (g % 5000)::text, ids.a[1 + g % ${MEMBERS}], now() - (g * interval '5 seconds')
      from generate_series(1, ${DOMAIN_EVENTS}) g, ids;
    `);
      // The AI ledger's "today" is the kit's manual clock, so seed relative to it.
      const aiNow = `timestamptz '${kit.clock.now().toISOString()}'`;
      await q(`
      with ids as (select array_agg(id) a from users where username like 'perf_user_%')
      insert into ai_requests (user_id, feature, surface, provider, model, status, error_code,
                               input_tokens, output_tokens, prompt_hash, created_at)
      select ids.a[1 + g % ${MEMBERS}],
             case when g % ${RARE_AI_FEATURE_EVERY} = 0 then 'draft_task'
                  else (array['ask','summarize','research','explain','analyze','brainstorm'])[1 + g % 6] end,
             'discord', 'mock', 'mock-1',
             (case when g % ${AI_ERROR_EVERY} = 0 then 'error' else 'ok' end)::ai_request_status,
             case when g % ${AI_ERROR_EVERY} = 0 then 'timeout' end,
             400, 300, md5(g::text) || md5(g::text), ${aiNow} - (g * interval '30 seconds')
      from generate_series(1, ${AI_REQUESTS}) g, ids;
      insert into ai_requests (user_id, feature, surface, provider, model, status, created_at)
      select '${focus.userId}', 'ask', 'dashboard', 'mock', 'mock-1', 'ok',
             ${aiNow} - (g * interval '15 minutes')
      from generate_series(1, ${FOCUS_AI_REQUESTS}) g;
    `);
      // Join and leave history for analytics: one join per member, one in ten left again.
      await q(`
      insert into guild_member_events (user_id, type, account_age_days, occurred_at)
      select u.id, 'join', 400, m.joined_guild_at
      from users u join members m on m.user_id = u.id where u.username like 'perf_user_%';
      insert into guild_member_events (user_id, type, occurred_at)
      select u.id, 'leave', m.joined_guild_at + interval '3 days'
      from users u join members m on m.user_id = u.id
      where u.username like 'perf_user_%' and substr(u.username, 11)::int % 10 = 0;
    `);
      await q('analyze');

      captured = [];
      let label = '';
      const db = kit.database.withQueryLog((sql, params) => captured.push({ label, sql, params }));
      const as = (actor: UserActor): ServiceContext => ({ ...kit.as(actor), db, rootDb: db });
      const run = async (name: string, call: () => Promise<unknown>) => {
        label = name;
        await call();
      };
      await run('inbox', () => listMyNotifications(as(focus), { limit: 25 }));
      await run('member directory', () => listMembers(as(founder), { limit: 25 }));
      await run('member search', () =>
        listMembers(as(founder), { search: 'perf_1234', limit: 25 }),
      );
      await run('audit by action', () =>
        listAuditLogs(as(founder), { action: 'role.granted', limit: 50 }),
      );
      await run('audit by actor', () =>
        listAuditLogs(as(founder), { actorUserId: founder.userId, limit: 50 }),
      );
      await run('audit (unfiltered)', () => listAuditLogs(as(founder), { limit: 50 }));
      await run('dead letters', () => listJobs(as(founder), { status: 'dead', limit: 25 }));
      await run('queue stats', () => getQueueStats(db, kit.clock.now()));
      await run('profile', () => getProfile(as(focus), { memberId: focus.memberId! }));
      await run('ai ledger (all)', () => listAiRequests(as(founder), { scope: 'all', limit: 50 }));
      await run('ai ledger by rare feature', () =>
        listAiRequests(as(founder), { scope: 'all', feature: 'draft_task', limit: 50 }),
      );
      await run('ai ledger by status', () =>
        listAiRequests(as(founder), { scope: 'all', status: 'error', limit: 50 }),
      );
      await run('ai ledger (mine)', () => listAiRequests(as(focus), { limit: 50 }));
      await run('ai usage today', () => getUsage(as(focus)));
      await run('ai usage by member', () => getUsageByUser(as(founder), { limit: 25 }));
      await run('ai org usage', () => getOrgUsage(as(founder), { days: 1 }));
      await run('analytics overview (30 days)', () =>
        getServerOverview(as(founder), { rangeDays: 30 }),
      );
      await run('javelin progress', () => getJavelinProgress(as(founder)));
      await run('job claim', () =>
        claimJobs(db, { workerId: 'perf', limit: 10, now: kit.clock.now(), types: ['perf.noop'] }),
      );
    });
    afterAll(async () => {
      await kit?.close();
    });

    it('keeps every hot statement off full scans of unbounded tables, within budget', async () => {
      const reports: PlanReport[] = [];
      for (const statement of captured) {
        const read = isRead(statement.sql);
        const explain = read ? 'explain (analyze, format json) ' : 'explain (format json) ';
        const [row] = await kit.database.query(explain + statement.sql, statement.params);
        const [plan] = row!['QUERY PLAN'] as [{ Plan: PlanNode; 'Execution Time'?: number }];
        reports.push({
          label: statement.label,
          kind: read ? 'read' : 'write',
          executionMs: plan['Execution Time'] ?? null,
          seqScans: collectSeqScans(plan.Plan, []),
        });
      }
      // Printed so the gauntlet log shows the numbers, not only pass/fail.
      console.table(
        reports.map((r) => ({
          path: r.label,
          kind: r.kind,
          ms: r.executionMs?.toFixed(1) ?? '(planned)',
          seqScans: r.seqScans.map((scan) => `${scan.table} (${scan.rows})`).join(', ') || '-',
        })),
      );
      expect(new Set(reports.map((r) => r.label)).size).toBe(19);
      const unboundedScans = reports.flatMap((r) =>
        r.seqScans
          .filter((scan) => UNBOUNDED_TABLES.has(scan.table) && scan.rows > SCAN_BUDGET_ROWS)
          .map((scan) => `${r.label}: seq scan of ${scan.rows} rows on ${scan.table}`),
      );
      expect(unboundedScans).toEqual([]);
      const slow = reports
        .filter((r) => r.executionMs !== null && r.executionMs > READ_BUDGET_MS)
        .map((r) => `${r.label}: ${r.executionMs!.toFixed(1)} ms`);
      expect(slow).toEqual([]);
    });
  },
);
