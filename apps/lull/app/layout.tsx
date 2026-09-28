import type { Metadata, Viewport } from 'next';
import { Figtree, Instrument_Serif, Syne } from 'next/font/google';
import type { ReactNode } from 'react';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { CartProvider } from '@/components/cart/CartProvider';
import { siteUrl } from '@/lib/env';
import { HERO } from '@/lib/content';
import './globals.css';

const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

const sans = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-figtree',
});

const display = Syne({
  weight: ['600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-syne',
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `Lull. ${HERO.headline} ${HERO.accent}`, template: '%s | Lull' },
  description: HERO.lead,
  applicationName: 'Lull',
  openGraph: { type: 'website', locale: 'de_DE', siteName: 'Lull' },
};

export const viewport: Viewport = {
  themeColor: '#140b3d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${serif.variable} ${sans.variable} ${display.variable}`}>
      <body>
        <CartProvider>
          {children}
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
