/** Discord's CDN serves member avatars. The only third-party origin the dashboard loads. */
export const AVATAR_ORIGIN = 'https://cdn.discordapp.com';

const NONCE_BYTES = 16;

export interface CspOptions {
  /** Per-request nonce; Next.js applies it to its own scripts automatically. */
  nonce: string;
  /** `next dev` needs eval (React debugging) and a websocket (HMR). Never in production. */
  development: boolean;
  /** Only when served over HTTPS; on plain-HTTP localhost it would break every asset. */
  upgradeInsecureRequests: boolean;
}

/**
 * Content-Security-Policy for dynamically rendered pages. Scripts require the
 * nonce (`strict-dynamic` lets Next.js chunks load their dependencies). Styles
 * allow inline attributes because Radix positions popovers with style attributes.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${options.nonce}'`,
      "'strict-dynamic'",
      ...(options.development ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', AVATAR_ORIGIN],
    ['font-src', "'self'"],
    ['connect-src', "'self'", ...(options.development ? ['ws:'] : [])],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (options.upgradeInsecureRequests) directives.push(['upgrade-insecure-requests']);
  return directives.map((parts) => parts.join(' ')).join('; ');
}

export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}
