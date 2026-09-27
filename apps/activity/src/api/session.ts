import { ApiError, type ApiClient, type RequestOptions } from './client';
import type { ActivityHost, AuthSession } from '../platform/hosts';

/** Re-authenticate this long before the JAVE token expires. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

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

  private async token(): Promise<string> {
    const session = this.current;
    if (!session || session.expiresAt - this.clock.now() <= REFRESH_MARGIN_MS) {
      return (await this.signIn()).token;
    }
    return session.token;
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
