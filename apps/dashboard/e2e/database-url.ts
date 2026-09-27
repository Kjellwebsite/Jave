/**
 * The end-to-end database: reset and seeded before the server starts, and
 * reachable from specs that add fixtures mid-run. Its name must contain "e2e".
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://jave:jave@localhost:5432/jave_e2e_dash';
