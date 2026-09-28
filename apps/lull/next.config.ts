import type { NextConfig } from 'next';

const ONE_YEAR_SECONDS = 31_536_000;

/** `next build` and `next start` run with NODE_ENV=production; `next dev` does not. */
const PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Static security headers for every response. No Content-Security-Policy yet: a nonce-based
 * policy would force every page to render dynamically, and the site is statically generated.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=(), browsing-topics=()',
  },
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
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into the app folder.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
