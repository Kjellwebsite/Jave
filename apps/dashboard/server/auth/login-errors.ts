/** Codes carried on /login?error=… and the calm sentence each maps to. */
export const LOGIN_ERRORS = {
  oauth_unavailable: 'Discord sign-in is not configured on this deployment.',
  oauth_state: 'The sign-in link expired or did not match. Start again.',
  oauth_denied: 'Discord sign-in was cancelled.',
  oauth_failed: 'Discord did not complete the sign-in. Try again shortly.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  dev_auth_disabled: 'Dev login is disabled on this deployment.',
  origin: 'The request did not come from this site.',
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export function loginErrorMessage(code: string | undefined): string | null {
  if (!code || !Object.hasOwn(LOGIN_ERRORS, code)) return null;
  return LOGIN_ERRORS[code as LoginErrorCode];
}
