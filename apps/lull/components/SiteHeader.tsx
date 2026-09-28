'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCart } from '@/components/cart/CartProvider';

export interface NavItem {
  href: string;
  label: string;
}

function CartButton() {
  const { count, open } = useCart();
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={open}
      className="icon-btn relative"
      aria-label={`Warenkorb öffnen, ${count} ${count === 1 ? 'Artikel' : 'Artikel'}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          d="M3.5 6.5h11l-1 9h-9z M6.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <span key={count} className="cart-count" aria-hidden="true">
        {count}
      </span>
    </button>
  );
}

/**
 * Top navigation, positioned by the page. Full link row from 1024 px; below that a menu button
 * opens the links in a panel.
 */
export function SiteHeader({ links, cta }: { links: NavItem[]; cta: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  return (
    <header ref={rootRef} className="enter relative z-30" style={{ animationDelay: '0.05s' }}>
      <nav aria-label="Hauptnavigation" className="flex h-14 items-center justify-between">
        <Link
          href="/"
          className="font-serif text-[32px] tracking-[0.5px] no-underline lg:text-[36px]"
          aria-label="Lull Startseite"
        >
          Lull
        </Link>
        <div className="hidden items-center gap-[34px] text-base font-medium lg:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="nav-link">
              {link.label}
            </Link>
          ))}
          <CartButton />
          {cta}
        </div>
        <div className="flex items-center gap-3 lg:hidden">
          <CartButton />
          <button
            type="button"
            className="icon-btn"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            aria-label={menuOpen ? 'Menü schließen' : 'Menü öffnen'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {menuOpen ? (
                <path
                  d="M4 4 L14 14 M14 4 L4 14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 6.5 H15 M3 11.5 H15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </nav>
      <div id={panelId} hidden={!menuOpen} className="lg:hidden">
        {menuOpen && (
          <div className="menu-panel absolute inset-x-0 top-[68px] flex flex-col gap-1 p-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-2xl px-4 py-3 font-serif text-[28px] leading-tight no-underline hover:bg-white/10"
              >
                {link.label}
              </Link>
            ))}
            <div className="px-2 pt-3 pb-1" onClick={() => setMenuOpen(false)}>
              {cta}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
