import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'JAVELIN', template: '%s — JAVELIN' },
  description: 'JAVE — the operating layer of JAVELIN.',
  applicationName: 'JAVELIN',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#08090A',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas text-fg">{children}</body>
    </html>
  );
}
