'use client';

import { useEffect, useRef } from 'react';
import { railScrollDelta } from '../lib/rail';

export interface RailActiveIntoViewProps {
  /** Identifies the active item; the rail is re-aligned whenever it changes. */
  activeKey: string;
}

/**
 * Place directly after a horizontally scrolling list (tab strip, chip rail).
 * Scrolls that list — horizontally only, never the page — so its
 * `aria-current="page"` item is visible, e.g. the active tab on a phone.
 */
export function RailActiveIntoView({ activeKey }: RailActiveIntoViewProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const rail = anchor.current?.previousElementSibling;
    if (!(rail instanceof HTMLElement)) return;
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const delta = railScrollDelta(rail.getBoundingClientRect(), active.getBoundingClientRect());
    if (delta !== 0) rail.scrollLeft += delta;
  }, [activeKey]);
  return <span ref={anchor} hidden />;
}
