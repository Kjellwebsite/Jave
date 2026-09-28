import Link from 'next/link';
import { SimplePage } from '@/components/SimplePage';
import { DEFAULT_PRODUCT, productPath } from '@/lib/products';

export default function NotFound() {
  return (
    <SimplePage title="Diese Seite gibt es nicht.">
      <p>Vielleicht hat sich die Adresse geändert. Hier geht es weiter:</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <Link href="/" className="btn btn-ink h-[54px] px-7 text-[16px]">
          Zur Startseite
        </Link>
        <Link
          href={productPath(DEFAULT_PRODUCT)}
          className="link-u self-center text-[16px] font-semibold text-ink"
        >
          Zum Shop
        </Link>
      </div>
    </SimplePage>
  );
}
