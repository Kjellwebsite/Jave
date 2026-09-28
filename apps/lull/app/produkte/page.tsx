import { redirect } from 'next/navigation';
import { DEFAULT_PRODUCT, productPath } from '@/lib/products';

export default function ProductsIndex() {
  redirect(productPath(DEFAULT_PRODUCT));
}
