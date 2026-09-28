import 'server-only';
import Stripe from 'stripe';
import { sanitizeLines, type CartLine } from './cart';
import { stripeSecretKey } from './env';
import { getProduct, priceCents } from './products';

/**
 * Stripe Checkout, test mode only for now. Without a key the checkout is off and says so; a
 * live key is refused until the launch items in the README are done.
 */

/** Where orders may ship. The copy promises delivery within Germany; confirm before launch. */
export const SHIPPING_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  ['DE'];

export type CheckoutResult =
  { ok: true; url: string } | { ok: false; status: number; code: string; message: string };

type SessionCreator = (
  key: string,
  params: Stripe.Checkout.SessionCreateParams,
) => Promise<{ url: string | null }>;

const createWithStripe: SessionCreator = (key, params) =>
  new Stripe(key).checkout.sessions.create(params);

export function isTestKey(key: string): boolean {
  return key.startsWith('sk_test_') || key.startsWith('rk_test_');
}

/** Parses `{ lines: [{ slug, qty }] }`. Anything malformed rejects the whole request. */
export function parseCheckoutBody(body: unknown): CartLine[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { lines?: unknown }).lines;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines = sanitizeLines(raw);
  // Never charge for a different cart than the one the customer saw.
  return lines.length === raw.length ? lines : null;
}

/** Prices and names come from the catalog, never from the request. */
export function checkoutParams(
  lines: CartLine[],
  origin: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    locale: 'de',
    line_items: lines.map((line) => {
      const product = getProduct(line.slug);
      if (!product) throw new Error(`Unknown product ${line.slug}`);
      return {
        quantity: line.qty,
        price_data: {
          currency: 'eur',
          unit_amount: priceCents(product),
          product_data: {
            name: `Lull ${product.name}`,
            description: `${product.category}. ${product.pack}.`,
            metadata: { slug: product.slug },
          },
        },
      };
    }),
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    success_url: `${origin}/bestellung?status=erfolg&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/bestellung?status=abgebrochen`,
  };
}

export async function createCheckout(
  body: unknown,
  origin: string,
  deps: { key?: string; create?: SessionCreator } = {},
): Promise<CheckoutResult> {
  const lines = parseCheckoutBody(body);
  if (!lines) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_cart',
      message: 'Der Warenkorb ist ungültig. Bitte lade die Seite neu.',
    };
  }

  const key = 'key' in deps ? deps.key : stripeSecretKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      code: 'checkout_disabled',
      message: 'Der Checkout ist noch nicht aktiv. Bald kannst du hier bestellen.',
    };
  }
  if (!isTestKey(key)) {
    console.error('Checkout refused: STRIPE_SECRET_KEY is not a test key (test mode only).');
    return {
      ok: false,
      status: 503,
      code: 'test_mode_only',
      message: 'Der Checkout ist noch nicht aktiv. Bald kannst du hier bestellen.',
    };
  }

  try {
    const session = await (deps.create ?? createWithStripe)(key, checkoutParams(lines, origin));
    if (!session.url) throw new Error('Stripe returned a session without a URL');
    return { ok: true, url: session.url };
  } catch (error) {
    console.error('Stripe checkout failed', error);
    return {
      ok: false,
      status: 502,
      code: 'stripe_error',
      message: 'Der Checkout ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
    };
  }
}
