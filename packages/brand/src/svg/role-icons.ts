/**
 * Discord role icons. Geometry lives in `role-marks.ts`; this module paints it.
 * Every mark carries a dark contour so it stays legible on Discord's light
 * theme; dark marks also carry a light rim for the dark theme.
 */
import { BRAND_ACCENTS, BRAND_COLORS, METAL_TONES } from '../colors';
import { ROLE_MARKS, ROLE_MARK_UNITS, roleMarkFacets, type RoleIconKey } from '../role-marks';
import { linearGradient, ramp, type GradientStop, type GradientVector } from './paint';
import { el, fragment, svgDocument, url } from './xml';

interface Stroke {
  readonly color: string;
  readonly opacity: number;
  readonly width: number;
}

interface RoleFinish {
  readonly light: readonly GradientStop[];
  readonly shade: readonly GradientStop[];
  /** Paint for unproven facets: a translucent tint with a solid outline. */
  readonly open: {
    readonly color: string;
    readonly fillOpacity: number;
    readonly strokeWidth: number;
  };
  readonly inlay: readonly GradientStop[];
  readonly contour: Stroke;
  readonly rim: Stroke | null;
}

const CONTOUR: Stroke = { color: BRAND_COLORS.black, opacity: 0.65, width: 4.5 };
/** A fine silver edge that lifts dark facets off Discord's dark theme. */
const SILVER_RIM: Stroke = { color: BRAND_COLORS.aluminium, opacity: 0.75, width: 3 };
/** Shaded facets are stroked with their own paint so shared edges never show a seam. */
const SEAM_STROKE_WIDTH = 1;

const NO_OPEN = { color: BRAND_COLORS.aluminium, fillOpacity: 0, strokeWidth: 0 } as const;

const ROLE_FINISHES: Readonly<Record<RoleIconKey, RoleFinish>> = {
  founder: {
    light: [
      { offset: 0, color: BRAND_COLORS.white },
      { offset: 0.4, color: METAL_TONES.iceTint },
      { offset: 0.7, color: METAL_TONES.champagneTint },
      { offset: 1, color: BRAND_COLORS.chrome },
    ],
    shade: ramp(BRAND_COLORS.steel, METAL_TONES.gunmetal),
    open: NO_OPEN,
    inlay: [],
    contour: CONTOUR,
    rim: SILVER_RIM,
  },
  core: {
    light: ramp(BRAND_COLORS.white, BRAND_COLORS.chrome),
    shade: ramp(METAL_TONES.aluminiumLow, BRAND_COLORS.steel),
    open: NO_OPEN,
    inlay: [],
    contour: CONTOUR,
    rim: null,
  },
  operations: {
    light: ramp(METAL_TONES.aluminiumLight, BRAND_COLORS.aluminium),
    shade: ramp(METAL_TONES.aluminiumLow, METAL_TONES.steelDeep),
    open: NO_OPEN,
    inlay: [],
    contour: CONTOUR,
    rim: null,
  },
  moderator: {
    light: ramp(BRAND_COLORS.steel, METAL_TONES.steelDeep),
    shade: ramp(METAL_TONES.gunmetal, BRAND_COLORS.graphite),
    open: NO_OPEN,
    inlay: ramp(BRAND_COLORS.white, BRAND_COLORS.aluminium),
    contour: CONTOUR,
    rim: SILVER_RIM,
  },
  verified: {
    light: ramp(BRAND_COLORS.white, BRAND_COLORS.chrome),
    shade: ramp(BRAND_COLORS.aluminium, METAL_TONES.aluminiumLow),
    open: NO_OPEN,
    inlay: [],
    contour: CONTOUR,
    rim: null,
  },
  trial: {
    light: ramp(METAL_TONES.trialLight, BRAND_ACCENTS.trial),
    shade: ramp(BRAND_ACCENTS.trial, METAL_TONES.trialDeep),
    open: { color: BRAND_ACCENTS.trial, fillOpacity: 0.25, strokeWidth: 3 },
    inlay: [],
    contour: CONTOUR,
    rim: null,
  },
  supporter: {
    light: ramp(METAL_TONES.supporterLight, BRAND_ACCENTS.supporter),
    shade: ramp(BRAND_ACCENTS.supporter, METAL_TONES.supporterDeep),
    open: NO_OPEN,
    inlay: [],
    contour: CONTOUR,
    rim: null,
  },
};

const FACET_VECTOR: GradientVector = {
  x1: 0,
  y1: 0,
  x2: ROLE_MARK_UNITS,
  y2: ROLE_MARK_UNITS,
  units: 'userSpaceOnUse',
};

/** Strokes every facet as one layer, so overlapping edges never double up. */
function silhouetteStroke(facets: readonly string[], stroke: Stroke): string {
  return el(
    'g',
    { opacity: stroke.opacity },
    el('path', {
      d: facets.join(' '),
      fill: 'none',
      stroke: stroke.color,
      'stroke-width': stroke.width,
      'stroke-linejoin': 'round',
    }),
  );
}

export function roleIconSvg(key: RoleIconKey): string {
  const mark = ROLE_MARKS[key];
  const finish = ROLE_FINISHES[key];
  const lightId = `${key}-light`;
  const shadeId = `${key}-shade`;
  const inlayId = `${key}-inlay`;
  const silhouette = roleMarkFacets(mark);
  const defs = [
    linearGradient(lightId, FACET_VECTOR, finish.light),
    linearGradient(shadeId, FACET_VECTOR, finish.shade),
    ...(mark.inlay ? [linearGradient(inlayId, FACET_VECTOR, finish.inlay)] : []),
  ];
  const body = [
    silhouetteStroke(silhouette, finish.contour),
    ...(finish.rim ? [silhouetteStroke(silhouette, finish.rim)] : []),
    ...mark.shadeFacets.map((d) =>
      el('path', {
        d,
        fill: url(shadeId),
        stroke: url(shadeId),
        'stroke-width': SEAM_STROKE_WIDTH,
        'stroke-linejoin': 'round',
      }),
    ),
    ...mark.openFacets.map((d) =>
      el('path', {
        d,
        fill: finish.open.color,
        'fill-opacity': finish.open.fillOpacity,
        stroke: finish.open.color,
        'stroke-width': finish.open.strokeWidth,
        'stroke-linejoin': 'round',
      }),
    ),
    ...mark.lightFacets.map((d) => el('path', { d, fill: url(lightId) })),
    ...(mark.inlay ? [el('path', { d: mark.inlay, fill: url(inlayId) })] : []),
  ];
  return svgDocument({
    width: ROLE_MARK_UNITS,
    height: ROLE_MARK_UNITS,
    title: `JAVELIN role icon — ${mark.label}`,
    content: fragment(defs, body),
  });
}
