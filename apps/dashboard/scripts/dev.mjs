import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm dev:dashboard`: loads the monorepo's root `.env`, then runs `next dev`.
 * Variables already set in the environment win over the file, and Next.js
 * still reads `apps/dashboard/.env.local` for anything left unset. (Node's
 * `--env-file` flag cannot be used: Next.js forwards it through NODE_OPTIONS,
 * where Node refuses it.)
 */
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  process.exit(signal ? 128 + constants.signals[signal] : (code ?? 0));
});
