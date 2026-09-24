/**
 * Shared pieces of the wide compositions (server banner, invite splash, Open
 * Graph image): the graphite field, machined divider bars and the motto.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import {
  BRUSHED_METAL_GRAIN,
  VERTICAL,
  brushedGrainFilter,
  linearGradient,
  type GradientStop,
  type GrainOptions,
} from './paint';
import { placeText, textWidth, type BrandTypography } from './typography';
import { combine, el, fragment, url, type Fragment } from './xml';

/**
 * Smallest cap height of the motto, in device pixels as displayed, in every
 * context a scene is sized for (README → Minimum sizes).
 */
export const MOTTO_MIN_DISPLAY_CAP_PX = 8;

/** An axis-aligned region of a canvas, canvas px. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One way a host shows a scene, and so its motto. */
export interface MottoDisplay {
  readonly context: string;
  /** The motto's cap height on the canvas, canvas px. */
  readonly capHeight: number;
  /** CSS px per canvas px in this context. */
  readonly scale: number;
  /** Device pixels per CSS px the context is judged at. */
  readonly pixelRatio: number;
}

/** The motto's cap height on screen, device px. */
export function displayedCapHeight(display: MottoDisplay): number {
  return display.capHeight * display.scale * display.pixelRatio;
}

const BACKDROP_STOPS: readonly GradientStop[] = [
  { offset: 0, color: METAL_TONES.graphiteMid },
  { offset: 0.55, color: BRAND_COLORS.graphite },
  { offset: 1, color: METAL_TONES.graphiteDeep },
];

/** Edge darkening that frames the field without drawing a border. */
const VIGNETTE_OPACITY = 0.45;
const VIGNETTE_INNER_OFFSET = 0.55;
/** Vignette radius as a fraction of the frame (objectBoundingBox), centred. */
const VIGNETTE_RADIUS = 0.75;
const FRAME_CENTER = 0.5;

/**
 * Faint brushing across the whole field: reads as dark brushed titanium up
 * close, and dithers the gradients so they never band in 8-bit output.
 */
const FIELD_GRAIN: GrainOptions & { readonly opacity: number } = {
  ...BRUSHED_METAL_GRAIN,
  seed: 7,
  opacity: 0.025,
};

/** The graphite field every scene sits on. */
export function backdrop(id: string, width: number, height: number): Fragment {
  const fieldId = `${id}-field`;
  const vignetteId = `${id}-vignette`;
  const grainId = `${id}-grain`;
  return fragment(
    [
      linearGradient(fieldId, VERTICAL, BACKDROP_STOPS),
      el(
        'radialGradient',
        { id: vignetteId, cx: FRAME_CENTER, cy: FRAME_CENTER, r: VIGNETTE_RADIUS },
        el('stop', {
          offset: VIGNETTE_INNER_OFFSET,
          'stop-color': BRAND_COLORS.black,
          'stop-opacity': 0,
        }),
        el('stop', {
          offset: 1,
          'stop-color': BRAND_COLORS.black,
          'stop-opacity': VIGNETTE_OPACITY,
        }),
      ),
      brushedGrainFilter(grainId, FIELD_GRAIN),
    ],
    [
      el('rect', { width, height, fill: url(fieldId) }),
      el('rect', { width, height, fill: url(vignetteId) }),
      el('rect', {
        width,
        height,
        fill: BRAND_COLORS.black,
        filter: url(grainId),
        opacity: FIELD_GRAIN.opacity,
      }),
    ],
  );
}

export interface DividerSpec {
  /** Length of the divider, output units. */
  readonly length: number;
  /** Thickness of the bright upper edge; the shaded lower edge matches it. */
  readonly thickness: number;
}

/** Peak opacity of a divider's chrome upper edge and steel lower edge. */
const DIVIDER_UPPER_OPACITY = 0.85;
const DIVIDER_LOWER_OPACITY = 0.6;

const DIVIDER_EDGES = [
  { edge: 'upper', color: BRAND_COLORS.chrome, opacity: DIVIDER_UPPER_OPACITY, above: true },
  { edge: 'lower', color: BRAND_COLORS.steel, opacity: DIVIDER_LOWER_OPACITY, above: false },
] as const;

/** Full strength in the middle, fading out toward both ends. */
function fadeBothEnds(color: string, peak: number): GradientStop[] {
  return [
    { offset: 0, color, opacity: 0 },
    { offset: 0.5, color, opacity: peak },
    { offset: 1, color, opacity: 0 },
  ];
}

/**
 * A machined bar centred on `centerX`, its chrome upper edge over a steel
 * lower edge, meeting at `y`. It fades out toward both ends.
 */
export function divider(id: string, centerX: number, y: number, spec: DividerSpec): Fragment {
  const from = centerX - spec.length / 2;
  const to = centerX + spec.length / 2;
  const defs: string[] = [];
  const body: string[] = [];
  for (const edge of DIVIDER_EDGES) {
    const gradientId = `${id}-${edge.edge}`;
    defs.push(
      linearGradient(
        gradientId,
        { x1: from, y1: 0, x2: to, y2: 0, units: 'userSpaceOnUse' },
        fadeBothEnds(edge.color, edge.opacity),
      ),
    );
    body.push(
      el('rect', {
        x: from,
        y: edge.above ? y - spec.thickness : y,
        width: spec.length,
        height: spec.thickness,
        fill: url(gradientId),
      }),
    );
  }
  return fragment(defs, body);
}

/** Baseline-to-baseline distance of the motto's lines, in cap heights. */
const MOTTO_LINE_ADVANCE = 1.9;

export interface MottoBox {
  /** Width of the longest line. */
  readonly width: number;
  /** From the top of the first line's capitals to the last baseline. */
  readonly height: number;
}

export function mottoBox(typography: BrandTypography, capHeight: number): MottoBox {
  const lines = typography.mottoLines.length;
  return {
    width: Math.max(...typography.mottoLines.map((line) => textWidth(line, capHeight))),
    height: capHeight * (1 + (lines - 1) * MOTTO_LINE_ADVANCE),
  };
}

export interface MottoPlacement {
  readonly centerX: number;
  /** Top of the first line's capitals. */
  readonly top: number;
  readonly capHeight: number;
}

/** The motto, one centred line per `BRAND_MOTTO_LINES` entry, in aluminium. */
export function motto(typography: BrandTypography, placement: MottoPlacement): Fragment {
  const { capHeight } = placement;
  return combine(
    ...typography.mottoLines.map((line, index) =>
      fragment(
        [],
        [
          placeText(line, {
            x: placement.centerX,
            baselineY: placement.top + capHeight * (1 + index * MOTTO_LINE_ADVANCE),
            capHeight,
            align: 'center',
            fill: BRAND_COLORS.aluminium,
          }),
        ],
      ),
    ),
  );
}
