/** Horizontal extent of an element, as from getBoundingClientRect(). */
export interface HorizontalBox {
  left: number;
  right: number;
}

/**
 * Space kept between the active item and the rail's edges once scrolled, so
 * it clears the `scroll-fade-x` trailing fade.
 */
export const RAIL_EDGE_CLEARANCE_PX = 32;

/**
 * How far to scroll a horizontal rail (added to `scrollLeft`) so `item` is
 * fully visible with clearance on both sides. 0 when it already is. When the
 * item is wider than the rail, its leading edge wins.
 */
export function railScrollDelta(
  rail: HorizontalBox,
  item: HorizontalBox,
  clearance = RAIL_EDGE_CLEARANCE_PX,
): number {
  const visibleLeft = rail.left + clearance;
  const visibleRight = rail.right - clearance;
  if (item.left < visibleLeft) return item.left - visibleLeft;
  if (item.right > visibleRight) {
    return Math.min(item.right - visibleRight, item.left - visibleLeft);
  }
  return 0;
}
