import { build } from 'esbuild';

/**
 * Bundles the bot (and its workspace packages + npm dependencies) into
 * self-contained ESM files. Only optional native accelerators stay external.
 */
const external = [
  'zlib-sync',
  'bufferutil',
  'utf-8-validate',
  '@discordjs/opus',
  'erlpack',
  'pino-pretty',
  '@electric-sql/pglite',
];

await build({
  entryPoints: {
    main: 'src/main.ts',
    migrate: '../../packages/database/src/scripts/migrate.ts',
    'deploy-commands': 'src/scripts/deploy-commands.ts',
    'print-commands': 'src/scripts/print-commands.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  legalComments: 'none',
  external,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
