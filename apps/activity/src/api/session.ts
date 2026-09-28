import { ApiError, type ApiClient, type RequestOptions } from './client';
import type { ActivityHost, AuthSession } from '../platform/hosts';

/** Re-authenticate this long before the JAVE token expires. */
export const REFRESH_MARGIN_MS = 5 * 60_000;
/** After a failed silent refresh, wait at least this long before the next attempt. */
export const REFRESH_RETRY_MS = 30_000;
const MS_PER_SECOND = 1000;

/**
 * Server time as seen from the client. Every API response carries
 * `serverNow`; countdowns and tick decisions use this, never the raw local
 * clock (players' clocks drift; the server decides).
 */
export class ServerClock {
  private offsetMs = 0;

  constructor(private readonly localNow: () => number = () => Date.now()) {}

  observe(serverNow: number): void {
    if (Number.isFinite(serverNow)) this.offsetMs = serverNow - this.localNow();
  }

  now(): number {
    return this.localNow() + this.offsetMs;
  }
}

/**
 * The signed-in session: keeps the JAVE token fresh (silent re-sign-in before
 * expiry, and once more on a 401) and feeds the server clock.
 */
export class ActivitySession {
  private current: AuthSession | null = null;
  private pending: Promise<AuthSession> | null = null;
  /** Server epoch ms before which no new silent refresh is attempted (after a failed one). */
  private refreshNotBefore = 0;

  constructor(
    private readonly host: ActivityHost,
    private readonly api: ApiClient,
    readonly clock: ServerClock,
  ) {}

  get auth(): AuthSession | null {
    return this.current;
  }

  /** Signs in (or refreshes); concurrent callers share one sign-in. */
  signIn(): Promise<AuthSession> {
    this.pending ??= this.host
      .signIn()
      .then((session) => {
        this.current = session;
        return session;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /**
   * The token for the next request. Inside the refresh margin the session
   * signs in again silently; if that fails (JAVELIN busy, connection lost)
   * while the current token is still valid, the current token is used and
   * the refresh waits before trying again, so a throttled sign-in never
   * interrupts a game that is running.
   */
  private async token(): Promise<string> {
    const session = this.current;
    const now = this.clock.now();
    if (!session || session.expiresAt <= now) return (await this.signIn()).token;
    if (session.expiresAt - now > REFRESH_MARGIN_MS || now < this.refreshNotBefore) {
      return session.token;
    }
    try {
      return (await this.signIn()).token;
    } catch (error) {
      const asked = error instanceof ApiError ? (error.retryAfterSeconds ?? 0) * MS_PER_SECOND : 0;
      this.refreshNotBefore = now + Math.max(REFRESH_RETRY_MS, asked);
      return session.token;
    }
  }

  async call<T>(
    method: 'GET' | 'POST',
    path: string,
    options: Omit<RequestOptions, 'token'> = {},
  ): Promise<T> {
    const send = async () =>
      this.api.request<T>(method, path, { ...options, token: await this.token() });
    let result: T;
    try {
      result = await send();
    } catch (error) {
      if (!(error instanceof ApiError) || !error.unauthenticated) throw error;
      this.current = null;
      result = await send();
    }
    const serverNow = (result as { serverNow?: unknown }).serverNow;
    if (typeof serverNow === 'number') this.clock.observe(serverNow);
    return result;
  }
}
