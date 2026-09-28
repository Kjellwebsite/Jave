import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';

/**
 * JVLN Activity — Vite build.
 *
 * The Activity calls the dashboard's `/api/activity/*` routes on its own
 * origin: inside Discord through the URL mapping (`/.proxy/api` → dashboard),
 * locally through this dev/preview proxy. Build tooling may read the process
 * environment; the app itself only sees `VITE_*` variables.
 */
const DEFAULT_DEV_PORT = 5173;
const DEFAULT_API_TARGET = 'http://localhost:3000';

const apiTarget = process.env.JAVE_ACTIVITY_API_TARGET ?? DEFAULT_API_TARGET;
const port = Number(process.env.JAVE_ACTIVITY_PORT ?? DEFAULT_DEV_PORT);

/** Both base paths reach the dashboard: `/api/…` directly and `/.proxy/api/…` as inside Discord. */
const proxy: Record<string, ProxyOptions> = {
  '/api': { target: apiTarget, changeOrigin: true },
  '/.proxy/api': {
    target: apiTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/\.proxy/, ''),
  },
};

/**
 * Production pages carry a strict CSP: same-origin scripts, styles, fonts and
 * API calls only (Discord proxies everything through the Activity origin).
 * Not applied in dev, where Vite injects inline HMR code.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'jave-activity-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * The monorepo's root `.env` configures every app. Vite exposes only
 * `VITE_*` variables to the bundle (VITE_DISCORD_CLIENT_ID, …); everything
 * else in that file (secrets included) never reaches the client.
 */
const ENV_DIR = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  envDir: ENV_DIR,
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  server: {
    port,
    strictPort: true,
    proxy,
    // Discord reaches a local dev server through a tunnel (docs/ACTIVITY.md).
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: { port, strictPort: true, proxy },
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
});
