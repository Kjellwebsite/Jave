/**
 * Build guard: the Activity bundle must never carry server code or secrets.
 *
 * Runs after `vite build` (and on demand: `pnpm --filter @jave/activity
 * check:bundle [distDir]`). It fails when the built files contain any trivia
 * bank prompt, answer or fact (the answers live only on the server), the name
 * of a server-side secret, or a server-only library.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const BANK_DIR = fileURLToPath(
  new URL('../../../packages/core/src/games/trivia/bank/', import.meta.url),
);
/** Short strings (e.g. "42") would match by chance; only distinctive text is checked. */
const MIN_MARKER_LENGTH = 12;
const BANK_FIELD = /\b(?:prompt|correct|fact):\s*'((?:[^'\\]|\\.)*)'/g;
const SERVER_MARKERS = [
  'JAVE_SESSION_SECRET',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_TOKEN',
  'DATABASE_URL',
  'JAVE_ENCRYPTION_KEY',
  'drizzle-orm',
  'server-only',
  'FOR UPDATE SKIP LOCKED',
] as const;
const BUILT_FILE = /\.(?:js|mjs|css|html)$/;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && BUILT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

async function bankMarkers(): Promise<string[]> {
  const markers: string[] = [];
  const sources = (await readdir(BANK_DIR)).filter((name) => name.endsWith('.ts'));
  for (const name of sources) {
    const text = await readFile(join(BANK_DIR, name), 'utf8');
    for (const match of text.matchAll(BANK_FIELD)) {
      const value = match[1]!.replace(/\\(.)/g, '$1');
      if (value.length >= MIN_MARKER_LENGTH) markers.push(value);
    }
  }
  return markers;
}

async function main(): Promise<void> {
  const dist = process.argv[2] ?? DEFAULT_DIST;
  const files = await listFiles(dist);
  if (files.length === 0) throw new Error(`no built files in ${dist}: run vite build first`);
  const bank = await bankMarkers();
  if (bank.length === 0) throw new Error(`no trivia bank found in ${BANK_DIR}`);
  const markers = [...bank, ...SERVER_MARKERS];
  const leaks: string[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const marker of markers) {
      if (content.includes(marker)) leaks.push(`${file}: ${marker.slice(0, 60)}`);
    }
  }
  if (leaks.length > 0) {
    throw new Error(`the Activity bundle carries server-only content:\n${leaks.join('\n')}`);
  }
  console.log(
    `bundle clean: ${files.length} files, ${bank.length} bank strings and ${SERVER_MARKERS.length} server markers checked`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
