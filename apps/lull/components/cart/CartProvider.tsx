'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  addLine,
  itemCount,
  removeLine,
  sanitizeLines,
  setLineQty,
  type CartLine,
} from '@/lib/cart';

const STORAGE_KEY = 'lull-cart-v1';

interface CartContextValue {
  lines: CartLine[];
  count: number;
  isOpen: boolean;
  add: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function readStored(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeLines(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/**
 * Cart stub: lines live in the browser (localStorage) until the shop has accounts or a
 * server-side cart. Checkout validates everything again on the server.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Read after hydration so the server and the first client render agree (empty cart).
  useEffect(() => {
    setLines(readStored());
    setLoaded(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setLines(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private mode or storage full: the cart still works for this page view.
    }
  }, [lines, loaded]);

  const add = useCallback((slug: string) => setLines((current) => addLine(current, slug)), []);
  const setQty = useCallback(
    (slug: string, qty: number) => setLines((current) => setLineQty(current, slug, qty)),
    [],
  );
  const remove = useCallback(
    (slug: string) => setLines((current) => removeLine(current, slug)),
    [],
  );
  const clear = useCallback(() => setLines([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      count: itemCount(lines),
      isOpen,
      add,
      setQty,
      remove,
      clear,
      open,
      close,
    }),
    [lines, isOpen, add, setQty, remove, clear, open, close],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart must be used inside <CartProvider>');
  return cart;
}
