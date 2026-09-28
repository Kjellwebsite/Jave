import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';

/** Light text page for order results, legal pages and 404, in the lower-page palette. */
export function SimplePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="on-light relative isolate min-h-dvh overflow-x-clip text-ink">
      <div
        aria-hidden="true"
        className="bg-under"
        style={{
          background:
            'linear-gradient(180deg, var(--color-lilac) 0px, var(--color-mist) 320px, var(--color-paper) 100%)',
        }}
      />
      <div aria-hidden="true" className="grain grain-under" />
      <div className="wrap flex min-h-dvh flex-col">
        <header className="flex items-center justify-between pt-4 lg:pt-10">
          <Link
            href="/"
            className="font-serif text-[32px] no-underline lg:text-[36px]"
            aria-label="Lull Startseite"
          >
            Lull
          </Link>
          <Link href="/" className="nav-link text-base font-medium">
            Zur Startseite
          </Link>
        </header>
        <div className="flex max-w-[680px] flex-col gap-5 py-20 lg:py-28">
          <h1 className="m-0 font-serif text-[48px] leading-none font-normal sm:text-[68px]">
            {title}
          </h1>
          <div className="flex flex-col gap-4 text-[17px] leading-[1.6] text-ink-soft">
            {children}
          </div>
        </div>
        <SiteFooter className="mt-auto pb-10 text-ink-soft" />
      </div>
    </main>
  );
}
