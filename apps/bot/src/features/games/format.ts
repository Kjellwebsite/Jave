/** Display names in panels are clipped to this length. */
export const NAME_MAX = 48;
/** Placements are zero-padded to this width so columns line up ("01", "12"). */
const PLACEMENT_WIDTH = 2;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/** Points and counts with thousands separators, locale-independent. */
export function formatPoints(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** "01", "02", … — a placement or leaderboard rank. */
export function placementLabel(value: number): string {
  return String(value).padStart(PLACEMENT_WIDTH, '0');
}
