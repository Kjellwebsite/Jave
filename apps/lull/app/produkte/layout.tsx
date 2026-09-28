import type { ReactNode } from 'react';
import { ProductExperience } from '@/components/product/ProductExperience';
import { placeholdersEnabled } from '@/lib/launch';

/**
 * One route per product, one shared layout: the experience stays mounted while the slug
 * changes, which is what makes the product switch animate instead of reload.
 */
export default function ProductsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ProductExperience showReviews={placeholdersEnabled()} />
      {children}
    </>
  );
}
