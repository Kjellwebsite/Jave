import type { Metadata } from 'next';
import Link from 'next/link';
import { SimplePage } from '@/components/SimplePage';
import { DEFAULT_PRODUCT, productPath } from '@/lib/products';
import { ClearCart } from './ClearCart';

export const metadata: Metadata = {
  title: 'Bestellung',
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ status?: string }>;
}

/** Stripe sends customers back here after checkout (see lib/checkout.ts). */
export default async function OrderPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const success = status === 'erfolg';
  return (
    <SimplePage title={success ? 'Danke für deine Bestellung.' : 'Bestellung abgebrochen.'}>
      {success ? (
        <>
          <ClearCart />
          <p>
            Deine Testbestellung ist durchgelaufen. Der Shop läuft noch im Stripe-Testmodus: es
            wurde nichts berechnet und es wird nichts verschickt.
          </p>
        </>
      ) : (
        <p>
          Es wurde nichts berechnet. Dein Warenkorb ist noch da, wenn du es noch einmal versuchen
          willst.
        </p>
      )}
      <Link
        href={success ? '/' : productPath(DEFAULT_PRODUCT)}
        className="btn btn-ink mt-4 h-[54px] self-start px-7 text-[16px]"
      >
        {success ? 'Zur Startseite' : 'Zurück zum Shop'}
      </Link>
    </SimplePage>
  );
}
