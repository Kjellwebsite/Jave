import type { Metadata } from 'next';
import { SimplePage } from './SimplePage';

export const legalMetadata = (title: string): Metadata => ({
  title,
  // Placeholder until the real text exists.
  robots: { index: false, follow: true },
});

/**
 * Mandatory pages (Impressum, Datenschutz, AGB, Widerruf) exist so the footer links work, but
 * their text has to come from the operator. Nothing here is invented; see the README.
 */
export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <SimplePage title={title}>
      <p>Dieser Inhalt wird vor dem Launch ergänzt.</p>
    </SimplePage>
  );
}
