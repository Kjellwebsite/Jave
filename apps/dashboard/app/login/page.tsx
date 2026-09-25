import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { buttonStyles, Callout, Emblem, Icon, RoleBadge, Wordmark } from '@jave/ui';
import { safeNextPath } from '@/lib/routes';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { devLoginAction } from '@/server/actions/auth';
import { DEV_PERSONAS, isDevAuthEnabled } from '@/server/auth/dev-auth';
import { loginErrorMessage } from '@/server/auth/login-errors';
import { getRequestContext } from '@/server/context';
import { getRuntime } from '@/server/runtime';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const { session } = await getRequestContext();
  if (session) redirect(next);

  const { env } = getRuntime();
  const oauthAvailable = Boolean(env.DISCORD_CLIENT_SECRET);
  const devAuth = isDevAuthEnabled(env);
  const error = loginErrorMessage(firstParam(params.error));
  const oauthHref = `/api/auth/discord?${new URLSearchParams({ next }).toString()}`;

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center px-4 py-14 sm:py-20">
      <div aria-hidden className="blueprint-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="flex w-full max-w-[400px] flex-col items-center">
        <Emblem size="xl" />
        <Wordmark size="lg" className="mt-7" />
        <p className="type-eyebrow mt-4 text-fg-subtle">OPERATIONS CONSOLE</p>

        <section
          aria-labelledby="sign-in-title"
          className="machined corner-ticks relative mt-12 w-full rounded-lg border border-line bg-surface p-6 sm:p-7"
        >
          <h1 id="sign-in-title" className="type-heading text-fg">
            Sign in
          </h1>
          <p className="mt-1.5 text-small text-fg-subtle">
            Your JAVELIN identity is your Discord account. JAVE reads your username and avatar —
            nothing else.
          </p>
          {error ? (
            <Callout tone="danger" role="alert" className="mt-5">
              {error}
            </Callout>
          ) : null}
          <div className="mt-6">
            {oauthAvailable ? (
              <a
                href={oauthHref}
                className={buttonStyles({ variant: 'primary', size: 'lg', className: 'w-full' })}
              >
                Continue with Discord
                <Icon icon={ArrowRight} />
              </a>
            ) : (
              <>
                <span
                  aria-disabled
                  className={buttonStyles({
                    variant: 'secondary',
                    size: 'lg',
                    className: 'w-full opacity-45',
                  })}
                >
                  Continue with Discord
                </span>
                <p className="mt-3 text-small text-fg-subtle">
                  Discord sign-in is not configured here. Set{' '}
                  <code className="type-data">DISCORD_CLIENT_SECRET</code> to enable it.
                </p>
              </>
            )}
          </div>
        </section>

        {devAuth ? (
          <section
            aria-labelledby="dev-login-title"
            className="mt-6 w-full rounded-lg border border-dashed border-warning/40 bg-warning/[0.03] p-5"
          >
            <div className="flex items-center gap-2 text-warning">
              <Icon icon={FlaskConical} size="sm" />
              <h2 id="dev-login-title" className="type-eyebrow">
                DEV LOGIN — MOCK / DEVELOPMENT ONLY
              </h2>
            </div>
            <p className="mt-2 text-small text-fg-subtle">
              Signs in as a fake Discord user with a fixed role. Refused in production.
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEV_PERSONAS.map((persona) => (
                <li key={persona.key} className="flex">
                  <form action={devLoginAction} className="flex w-full">
                    <input type="hidden" name="persona" value={persona.key} />
                    <input type="hidden" name="next" value={next} />
                    <button
                      type="submit"
                      data-persona={persona.key}
                      className="group flex w-full flex-col items-start justify-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
                    >
                      <RoleBadge role={persona.role} size="sm" />
                      <span className="text-small text-fg-subtle group-hover:text-fg-muted">
                        {persona.description}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="type-data mt-10 text-center text-[11px] leading-relaxed text-fg-faint">
          YOU THINK YOU’RE ELITE? PROVE IT.
        </p>
      </div>
    </main>
  );
}
