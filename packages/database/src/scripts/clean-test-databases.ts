import postgres from 'postgres';

/**
 * Drop leftover test databases on the server at JAVE_TEST_POSTGRES_URL:
 * per-test databases (jave_t_*) that nobody is connected to, and with
 * --templates also every template (jave_tpl_*), which the next run rebuilds.
 * Never touches any other database. For local and CI servers only.
 */
const TEST_DATABASE_PATTERN = 'jave\\_t\\_%';
const TEMPLATE_PATTERN = 'jave\\_tpl\\_%';

async function main(): Promise<void> {
  const url = process.env.JAVE_TEST_POSTGRES_URL;
  if (!url) {
    console.error('JAVE_TEST_POSTGRES_URL is not set');
    process.exit(1);
  }
  const withTemplates = process.argv.includes('--templates');
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql<{ datname: string; template: boolean }[]>`
      select d.datname, d.datistemplate as template
      from pg_database d
      where (d.datname like ${TEST_DATABASE_PATTERN}
             or (${withTemplates} and d.datname like ${TEMPLATE_PATTERN}))
        and not exists (select 1 from pg_stat_activity a where a.datname = d.datname)`;
    for (const { datname, template } of rows) {
      // Names match the harness's own hex patterns, so interpolation is safe.
      if (!/^jave_(t|tpl)_[0-9a-f_]+$/.test(datname)) continue;
      if (template) await sql.unsafe(`alter database ${datname} is_template false`);
      await sql.unsafe(`drop database if exists ${datname}`);
    }
    console.log(`dropped ${rows.length} test database(s)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('cleanup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
