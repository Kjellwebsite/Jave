import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getProduct, PRODUCTS, priceCents, productPath } from '@/lib/products';

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = getProduct((await params).slug);
  if (!product) return {};
  const title = `${product.name} · ${product.category}`;
  return {
    title,
    description: product.hero.subline,
    alternates: { canonical: productPath(product) },
    openGraph: { title: `Lull ${title}`, description: product.hero.subline },
  };
}

/**
 * The visible page is rendered by `app/produkte/layout.tsx`, which stays mounted across
 * products. This route adds per-product metadata and structured data. Ratings are left out of
 * the structured data on purpose: they are placeholders.
 */
export default async function ProductPage({ params }: Props) {
  const product = getProduct((await params).slug);
  if (!product) notFound();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `Lull ${product.name}`,
    description: product.hero.subline,
    category: product.category,
    brand: { '@type': 'Brand', name: 'Lull' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: (priceCents(product) / 100).toFixed(2),
      url: productPath(product),
    },
  };
  return (
    <script
      type="application/ld+json"
      // Escape "<" so product copy can never close the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
    />
  );
}
