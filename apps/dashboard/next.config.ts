import path from 'node:path';
import type { NextConfig } from 'next';

const ONE_YEAR_SECONDS = 31_536_000;

/** `next build` and `next start` run with NODE_ENV=production; `next dev` does not. */
const PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Static security headers for every response (pages, API routes, assets).
 * The Content-Security-Policy is per-request (nonce) and set in `proxy.ts`.
 * HSTS is sent by production builds only.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(PRODUCTION
    ? [
        {
          key: 'Strict-Transport-Security',
          value: `max-age=${ONE_YEAR_SECONDS}; includeSubDomains`,
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Monorepo root, so standalone output traces the workspace packages.
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  transpilePackages: [
    '@jave/ui',
    '@jave/brand',
    '@jave/core',
    '@jave/database',
    '@jave/config',
    '@jave/ai',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
