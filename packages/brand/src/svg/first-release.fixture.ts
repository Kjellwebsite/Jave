/**
 * TEST FIXTURE — never rendered into an asset. The server icon exactly as the
 * kit first shipped it: a light plate face, light-steel shaded facets and a
 * faint, straight-down relief. At 16 px it read as a plain silver tile. Tests
 * rebuild it to prove their checks would have caught that release.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import { ramp } from './paint';
import { PADDED_PLATE_LAYOUT, type PlateIconSpec } from './icons';
import { ALUMINIUM_PLATE } from './plates';

/** The first release's emblem radius on the 1024 plate. */
const FIRST_RELEASE_EMBLEM_RADIUS = 296;
/** The first release's diagonal sheen peak. */
const FIRST_RELEASE_SHEEN_PEAK = 0.3;
const FIRST_RELEASE_CONTOUR_OPACITY = 0.5;

export const FIRST_RELEASE_PLATE_FACE = [
  { offset: 0, color: '#D2D6DB' },
  { offset: 0.4, color: '#B9BEC4' },
  { offset: 1, color: '#9EA4AB' },
] as const;

export const FIRST_RELEASE_SERVER_ICON: PlateIconSpec = {
  layout: { ...PADDED_PLATE_LAYOUT, emblemRadius: FIRST_RELEASE_EMBLEM_RADIUS },
  material: {
    ...ALUMINIUM_PLATE,
    face: FIRST_RELEASE_PLATE_FACE,
    sheen: ALUMINIUM_PLATE.sheen.map((stop) =>
      (stop.opacity ?? 1) > 0 ? { ...stop, opacity: FIRST_RELEASE_SHEEN_PEAK } : stop,
    ),
    well: undefined,
    emblemFinish: {
      light: ramp(BRAND_COLORS.white, BRAND_COLORS.chrome),
      shade: ramp(METAL_TONES.aluminiumLow, BRAND_COLORS.steel),
    },
    emblemRelief: {
      ...ALUMINIUM_PLATE.emblemRelief,
      shadows: [
        { blur: 16, offsetY: 12, opacity: 0.18 },
        { blur: 5, offsetY: 6, opacity: 0.3 },
        { blur: 1.2, offsetY: 1.5, opacity: 0.4 },
      ],
      contour: { ...ALUMINIUM_PLATE.emblemRelief.contour, opacity: FIRST_RELEASE_CONTOUR_OPACITY },
    },
  },
};
