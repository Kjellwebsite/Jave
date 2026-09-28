import Link from 'next/link';
import { DISCLAIMER } from '@/lib/content';

export const LEGAL_PAGES = [
  { href: '/impressum', label: 'Impressum' },
  { href: '/datenschutz', label: 'Datenschutz' },
  { href: '/agb', label: 'AGB' },
  { href: '/widerruf', label: 'Widerruf' },
] as const;

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={[
        'flex flex-col gap-4 text-[14px] leading-[1.5] lg:flex-row lg:items-center lg:justify-between lg:gap-10',
        className ?? '',
      ].join(' ')}
    >
      <p className="m-0">{DISCLAIMER}</p>
      <nav aria-label="Rechtliches" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {LEGAL_PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="nav-link">
            {page.label}
          </Link>
        ))}
        <span>Lull 2026</span>
      </nav>
    </footer>
  );
}
