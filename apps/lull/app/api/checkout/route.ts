import { createCheckout } from '@/lib/checkout';

/** POST { lines: [{ slug, qty }] } → { url } of a Stripe Checkout session (test mode). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Der Warenkorb ist ungültig. Bitte lade die Seite neu.' },
      { status: 400 },
    );
  }
  const result = await createCheckout(body, new URL(request.url).origin);
  if (result.ok) return Response.json({ url: result.url });
  return Response.json({ error: result.code, message: result.message }, { status: result.status });
}
