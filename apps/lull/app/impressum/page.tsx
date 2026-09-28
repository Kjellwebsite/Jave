import { LegalPlaceholder, legalMetadata } from '@/components/LegalPlaceholder';

export const metadata = legalMetadata('Impressum');

export default function Page() {
  return <LegalPlaceholder title="Impressum" />;
}
