import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig, PgTable, PgEnumColumn } from 'drizzle-orm/pg-core';
import { getTableName, is, SQL } from 'drizzle-orm';
import * as schema from '../schema';

/**
 * Generates DATABASE.md from the Drizzle schema so the documentation can never
 * drift from the code. Run: pnpm --filter @jave/database docs
 */

const DOMAIN_OF: [RegExp, string][] = [
  [
    /^(users|members|member_roles|sessions|user_preferences|rank_tiers|capability_|member_capabilities|evidence|rank_history|member_notes|guild_member_events)/,
    'Identity & ranking',
  ],
  [/^application/, 'Applications'],
  [/^verification/, 'Verification'],
  [/^trial/, 'Trials'],
  [/^adversarial/, 'Adversarial (staff-only)'],
  [/^ticket/, 'Tickets'],
  [/^(security_events|mod_cases)/, 'Moderation & security'],
  [/^(campaigns|invite_codes|referral)/, 'Invites & referrals'],
  [/^(achievement|member_achievements)/, 'Achievements'],
  [/^(project|contributions)/, 'Projects & contributions'],
  [/^mission/, 'Missions'],
  [/^(events|event_|tournament)/, 'Events & tournaments'],
  [/^notification/, 'Notifications'],
  [/^ai_/, 'AI'],
  [/^research/, 'Research (Sidus)'],
  [/^(integrations|webhook_|outbound_|external_accounts)/, 'Integrations & webhooks'],
  [/^game/, 'Games'],
  [
    /^(audit_logs|domain_events|jobs|server_settings|analytics_snapshots|rate_limit_buckets)/,
    'Platform',
  ],
];

function domainFor(table: string): string {
  return DOMAIN_OF.find(([pattern]) => pattern.test(table))?.[1] ?? 'Other';
}

function columnType(column: ReturnType<typeof getTableConfig>['columns'][number]): string {
  if (column instanceof PgEnumColumn) return `enum(${column.enumValues.join(' · ')})`;
  const sqlType = column.getSQLType();
  return sqlType;
}

function renderDefault(value: unknown): string {
  if (is(value, SQL)) {
    return value.queryChunks
      .map((chunk) =>
        chunk && typeof chunk === 'object' && 'value' in chunk && Array.isArray(chunk.value)
          ? chunk.value.join('')
          : '?',
      )
      .join('');
  }
  return JSON.stringify(value);
}

const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable =>
  is(value, PgTable),
);
const byDomain = new Map<string, PgTable[]>();
for (const table of tables) {
  const domain = domainFor(getTableName(table));
  byDomain.set(domain, [...(byDomain.get(domain) ?? []), table]);
}

const out: string[] = [
  '# Database',
  '',
  '> Generated from `packages/database/src/schema` by `pnpm --filter @jave/database docs`. Do not edit by hand.',
  '',
  'PostgreSQL 16 · Drizzle ORM · migrations in `packages/database/drizzle` · reference data in `src/reference-data.ts`.',
  '',
  '## Conventions',
  '',
  '- UUID primary keys (`gen_random_uuid()`); append-only logs use identity `bigint` keys.',
  '- Human-facing sequential numbers (applications, tickets, cases, trials, missions, verifications) are identity columns.',
  '- Discord snowflakes are `varchar(20)`. All timestamps are `timestamptz`.',
  '- Soft deletion via `deleted_at` where history must survive (members, projects, evidence, research).',
  '- Invariants live in the database: foreign keys, unique and partial unique indexes.',
  '- Every sensitive change is also written to `audit_logs`; every meaningful change emits a `domain_events` row in the same transaction.',
  '',
  `## Tables (${tables.length})`,
  '',
];

const order = [...new Set(DOMAIN_OF.map(([, d]) => d)), 'Other'];
for (const domain of order) {
  const list = byDomain.get(domain);
  if (!list) continue;
  out.push(`### ${domain}`, '');
  for (const table of list.sort((a, b) => getTableName(a).localeCompare(getTableName(b)))) {
    const config = getTableConfig(table);
    out.push(`#### \`${config.name}\``, '');
    out.push('| Column | Type | Null | Default | References |', '| --- | --- | :-: | --- | --- |');
    const fkByColumn = new Map<string, string>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const target = `${getTableName(ref.foreignTable)}.${ref.foreignColumns.map((c) => c.name).join(',')}`;
      const onDelete =
        fk.onDelete && fk.onDelete !== 'no action' ? ` (on delete ${fk.onDelete})` : '';
      for (const c of ref.columns) fkByColumn.set(c.name, `\`${target}\`${onDelete}`);
    }
    for (const column of config.columns) {
      const pk = column.primary ? ' **PK**' : '';
      const def = column.hasDefault
        ? column.default !== undefined
          ? `\`${renderDefault(column.default)}\``
          : column.generatedIdentity
            ? 'identity'
            : column.defaultFn
              ? 'app'
              : 'sql'
        : '';
      out.push(
        `| \`${column.name}\`${pk} | ${columnType(column)} | ${column.notNull ? '' : '✓'} | ${def} | ${fkByColumn.get(column.name) ?? ''} |`,
      );
    }
    const indexes = config.indexes.map((index) => {
      const cfg = index.config;
      const cols = cfg.columns.map((c) => ('name' in c ? c.name : 'expr')).join(', ');
      return `- ${cfg.unique ? 'UNIQUE ' : ''}\`${cfg.name}\` (${cols})${cfg.where ? ' — partial' : ''}`;
    });
    const composite = config.primaryKeys.map(
      (pk) => `- PRIMARY KEY (${pk.columns.map((c) => c.name).join(', ')})`,
    );
    if (indexes.length || composite.length) out.push('', ...composite, ...indexes);
    out.push('');
  }
}

const target = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'DATABASE.md');
writeFileSync(target, `${out.join('\n')}\n`);
console.log(`wrote ${target} (${tables.length} tables)`);
