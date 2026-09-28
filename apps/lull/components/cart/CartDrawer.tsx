'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TabletFace } from '@/components/TabletFace';
import { MAX_QTY, subtotalCents } from '@/lib/cart';
import { formatEuro } from '@/lib/price';
import { getProduct, palette, priceCents, productPath } from '@/lib/products';
import { useCart } from './CartProvider';

type CheckoutState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string };

interface CheckoutResponse {
  url?: string;
  message?: string;
}

async function startCheckout(lines: { slug: string; qty: number }[]): Promise<string> {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
  const body = (await response.json().catch(() => ({}))) as CheckoutResponse;
  if (!response.ok || !body.url) {
    throw new Error(body.message ?? 'Der Checkout ist gerade nicht erreichbar.');
  }
  return body.url;
}

/** The cart as a modal side sheet (native <dialog>: focus trap, Escape and inert page for free). */
export function CartDrawer() {
  const cart = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: 'idle' });
  const { isOpen, close } = cart;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setCheckout({ kind: 'idle' });
      dialog.showModal();
    }
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Escape closes the dialog natively; keep the provider in sync.
    const onClose = () => close();
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [close]);

  const subtotal = subtotalCents(cart.lines);

  async function onCheckout() {
    setCheckout({ kind: 'loading' });
    try {
      window.location.assign(await startCheckout(cart.lines));
    } catch (error) {
      setCheckout({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Der Checkout ist gerade nicht erreichbar.',
      });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="drawer"
      aria-labelledby="cart-title"
      onClick={(event) => {
        // A click on the backdrop targets the <dialog> itself.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 sm:px-8 sm:pt-8">
          <h2 id="cart-title" className="font-serif text-[40px] leading-none">
            Warenkorb
          </h2>
          <button
            type="button"
            onClick={close}
            className="qty-btn h-11! w-11!"
            aria-label="Warenkorb schließen"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 3 L13 13 M13 3 L3 13"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-start gap-5 px-6 sm:px-8">
            <p className="text-[17px] leading-[1.6] text-ink-soft">Dein Warenkorb ist leer.</p>
            <Link
              href="/#sortiment"
              onClick={close}
              className="btn btn-ink h-[52px] px-7 text-base"
            >
              Sortiment ansehen
            </Link>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto px-6 sm:px-8" aria-label="Artikel">
            {cart.lines.map((line) => {
              const product = getProduct(line.slug);
              if (!product) return null;
              return (
                <li
                  key={line.slug}
                  className="flex items-center gap-4 border-b border-ink/12 py-5 last:border-b-0"
                >
                  <TabletFace
                    palette={palette(product)}
                    size={52}
                    edge={3}
                    drop="0 12px 16px rgba(10,5,40,0.25)"
                    className="mb-2"
                  >
                    <span className="btab-score" />
                  </TabletFace>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={productPath(product)}
                      onClick={close}
                      className="font-serif text-[26px] leading-none no-underline"
                    >
                      Lull {product.name}
                    </Link>
                    <span className="text-[13px] text-ink-mute">{product.pack}</span>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => cart.setQty(line.slug, line.qty - 1)}
                        aria-label={`Eine Packung Lull ${product.name} weniger`}
                      >
                        −
                      </button>
                      <span
                        className="min-w-6 text-center font-display text-[15px] font-bold"
                        aria-live="polite"
                      >
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => cart.setQty(line.slug, line.qty + 1)}
                        disabled={line.qty >= MAX_QTY}
                        aria-label={`Eine Packung Lull ${product.name} mehr`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => cart.remove(line.slug)}
                        className="link-u ml-auto cursor-pointer text-[13px] font-semibold"
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                  <span className="self-start pt-1 font-display text-[17px] font-extrabold whitespace-nowrap">
                    {formatEuro(priceCents(product) * line.qty)} €
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {cart.lines.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-ink/12 px-6 pt-5 pb-7 sm:px-8">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">Zwischensumme</span>
              <span className="font-display text-[24px] font-extrabold">
                {formatEuro(subtotal)} €
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ink h-14 w-full text-[17px]"
              onClick={() => void onCheckout()}
              disabled={checkout.kind === 'loading'}
            >
              {checkout.kind === 'loading' ? 'Einen Moment…' : 'Zur Kasse'}
            </button>
            <p role="status" className="min-h-[1.5em] text-[14px] leading-[1.5] text-ink-soft">
              {checkout.kind === 'error' ? checkout.message : ''}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
}
