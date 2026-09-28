import { LegalPlaceholder, legalMetadata } from '@/components/LegalPlaceholder';

export const metadata = legalMetadata('Datenschutz');

export default function Page() {
  return <LegalPlaceholder title="Datenschutz" />;
}
