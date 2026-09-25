/** Opaque session token (httpOnly). Only its SHA-256 hash is stored server-side. */
export const SESSION_COOKIE = 'jave_session';
/** Short-lived, HMAC-signed OAuth state + PKCE verifier (httpOnly). */
export const OAUTH_STATE_COOKIE = 'jave_oauth';
