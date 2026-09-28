import { LegalPlaceholder, legalMetadata } from '@/components/LegalPlaceholder';

export const metadata = legalMetadata('AGB');

export default function Page() {
  return <LegalPlaceholder title="AGB" />;
}
