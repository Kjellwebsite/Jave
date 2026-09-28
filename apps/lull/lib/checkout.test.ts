import { describe, expect, it, vi } from 'vitest';
import { addLine, itemCount, MAX_QTY, sanitizeLines, setLineQty, subtotalCents } from './cart';
import { checkoutParams, createCheckout, isTestKey, parseCheckoutBody } from './checkout';

describe('cart', () => {
  it('adds, merges and caps lines', () => {
    let lines = addLine([], 'calm');
    lines = addLine(lines, 'calm');
    lines = addLine(lines, 'drift');
    expect(lines).toEqual([
      { slug: 'calm', qty: 2 },
      { slug: 'drift', qty: 1 },
    ]);
    expect(itemCount(lines)).toBe(3);
    expect(subtotalCents(lines)).toBe(2 * 2990 + 2490);
    expect(setLineQty(lines, 'calm', 99)[0]!.qty).toBe(MAX_QTY);
    expect(setLineQty(lines, 'calm', 0)).toEqual([{ slug: 'drift', qty: 1 }]);
    expect(addLine(lines, 'unknown')).toEqual(lines);
  });

  it('BREAK: drops tampered stored carts', () => {
    expect(sanitizeLines('nope')).toEqual([]);
    expect(
      sanitizeLines([
        { slug: 'calm', qty: 1 },
        { slug: 'calm', qty: 2 },
        { slug: 'spark', qty: 0 },
        { slug: 'bloom', qty: 1.5 },
        { slug: 'tide', qty: 11 },
        { slug: 'x', qty: 1 },
        null,
      ]),
    ).toEqual([{ slug: 'calm', qty: 1 }]);
  });
});

describe('checkout', () => {
  const origin = 'https://lull.example';
  const body = { lines: [{ slug: 'spark', qty: 2 }] };

  it('only accepts Stripe test keys', () => {
    expect(isTestKey('sk_test_123')).toBe(true);
    expect(isTestKey('rk_test_123')).toBe(true);
    expect(isTestKey('sk_live_123')).toBe(false);
  });

  it('BREAK: rejects carts it would not charge as shown', () => {
    expect(parseCheckoutBody(null)).toBeNull();
    expect(parseCheckoutBody({ lines: [] })).toBeNull();
    expect(
      parseCheckoutBody({
        lines: [
          { slug: 'spark', qty: 2 },
          { slug: 'evil', qty: 1 },
        ],
      }),
    ).toBeNull();
    expect(parseCheckoutBody({ lines: [{ slug: 'spark', qty: 2, price: 1 }] })).toEqual([
      { slug: 'spark', qty: 2 },
    ]);
  });

  it('BREAK: takes prices from the catalog, never from the request', () => {
    const params = checkoutParams([{ slug: 'spark', qty: 2 }], origin);
    expect(params.mode).toBe('payment');
    expect(params.line_items).toEqual([
      {
        quantity: 2,
        price_data: {
          currency: 'eur',
          unit_amount: 2790,
          product_data: {
            name: 'Lull Spark',
            description: 'Fokus. Blister, 14 Tabletten.',
            metadata: { slug: 'spark' },
          },
        },
      },
    ]);
    expect(params.success_url).toBe(
      `${origin}/bestellung?status=erfolg&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(params.cancel_url).toBe(`${origin}/bestellung?status=abgebrochen`);
  });

  it('is off without a key', async () => {
    const result = await createCheckout(body, origin, { key: undefined });
    expect(result).toMatchObject({ ok: false, status: 503, code: 'checkout_disabled' });
  });

  it('BREAK: refuses a live key while the shop is in test mode', async () => {
    const create = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createCheckout(body, origin, { key: 'sk_live_abc', create });
    expect(result).toMatchObject({ ok: false, status: 503, code: 'test_mode_only' });
    expect(create).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('returns the Stripe checkout URL in test mode', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const result = await createCheckout(body, origin, { key: 'sk_test_abc', create });
    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(create).toHaveBeenCalledWith(
      'sk_test_abc',
      expect.objectContaining({ mode: 'payment' }),
    );
  });

  it('reports Stripe failures without leaking them', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Invalid API Key provided: sk_test_***'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createCheckout(body, origin, { key: 'sk_test_abc', create });
    expect(result).toMatchObject({ ok: false, status: 502, code: 'stripe_error' });
    expect(JSON.stringify(result)).not.toContain('sk_test');
    error.mockRestore();
  });
});
