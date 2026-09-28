'use client';

import { useEffect } from 'react';
import { useCart } from '@/components/cart/CartProvider';

/** After a completed checkout the cart has been paid for; empty it once. */
export function ClearCart() {
  const { clear } = useCart();
  useEffect(() => clear(), [clear]);
  return null;
}
