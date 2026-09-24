/**
 * Icon plates: the machined tile behind the emblem on the Discord server icon,
 * the bot avatar and the touch icon. A plate is a rounded square with a
 * bevelled rim, a brushed face, a soft cast shadow and the emblem set into it.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import {
  EMBLEM_FINISHES,
  emblemArt,
  placementCentered,
  type EmblemFinish,
  type EmblemRelief,
} from './emblem-art';
import {
  BRUSHED_METAL_GRAIN,
  DIAGONAL,
  VERTICAL,
  brushedGrainFilter,
  clipPath,
  linearGradient,
  shadowFilter,
  type GradientStop,
  type GrainOptions,
  type ShadowLayer,
} from './paint';
import { combine, el, fragment, url, type Fragment } from './xml';

export interface PlateMaterial {
  /** Rim (outer bevel band), painted top to bottom. */
  readonly rim: readonly GradientStop[];
  /** Brushed face, painted top to bottom. */
  readonly face: readonly GradientStop[];
  readonly grain: GrainOptions & { readonly opacity: number };
  /** Broad, faint anisotropic highlight across the face (top-left to bottom-right). */
  readonly sheen: readonly GradientStop[];
  /** Inner bevel: highlight along the top edge, shadow along the bottom edge. */
  readonly bevel: {
    readonly width: number;
    readonly highlight: string;
    readonly highlightOpacity: number;
    readonly shadow: string;
    readonly shadowOpacity: number;
  };
  /** Hairline that defines the plate against light backgrounds. */
  readonly edge: { readonly color: string; readonly opacity: number; readonly width: number };
  readonly castShadow: { readonly color: string; readonly layers: readonly ShadowLayer[] };
  readonly emblemFinish: EmblemFinish;
  readonly emblemRelief: EmblemRelief;
}

export interface PlateLayout {
  /** Square canvas side, px. */
  readonly size: number;
  /** Transparent padding around the plate; 0 makes the plate full-bleed. */
  readonly inset: number;
  readonly cornerRadius: number;
  readonly rimWidth: number;
  /** Radius of the emblem's enclosing circle, px. */
  readonly emblemRadius: number;
  /**
   * How far above the canvas centre the emblem's bounding box is centred, px.
   * The wings put the emblem's visual weight low, so it sits slightly high.
   */
  readonly emblemLift: number;
}

/** Brushed aluminium — the flagship server icon surface. Cool, clean silver. */
export const ALUMINIUM_PLATE: PlateMaterial = {
  rim: [
    { offset: 0, color: METAL_TONES.aluminiumHighlight },
    { offset: 0.18, color: METAL_TONES.aluminiumLight },
    { offset: 0.7, color: METAL_TONES.aluminiumLow },
    { offset: 1, color: BRAND_COLORS.steel },
  ],
  face: [
    { offset: 0, color: METAL_TONES.aluminiumFaceTop },
    { offset: 0.4, color: METAL_TONES.aluminiumFaceMid },
    { offset: 1, color: METAL_TONES.aluminiumFaceLow },
  ],
  grain: { ...BRUSHED_METAL_GRAIN, seed: 23, opacity: 0.12 },
  sheen: [
    { offset: 0, color: BRAND_COLORS.white, opacity: 0 },
    { offset: 0.2, color: BRAND_COLORS.white, opacity: 0.3 },
    { offset: 0.42, color: BRAND_COLORS.white, opacity: 0 },
    { offset: 1, color: BRAND_COLORS.white, opacity: 0 },
  ],
  bevel: {
    width: 7,
    highlight: BRAND_COLORS.white,
    highlightOpacity: 0.6,
    shadow: BRAND_COLORS.black,
    shadowOpacity: 0.2,
  },
  edge: { color: METAL_TONES.steelDeep, opacity: 0.55, width: 2 },
  castShadow: {
    color: BRAND_COLORS.black,
    layers: [
      { blur: 12, offsetY: 10, opacity: 0.28 },
      { blur: 3, offsetY: 3, opacity: 0.22 },
    ],
  },
  emblemFinish: EMBLEM_FINISHES.chrome,
  emblemRelief: {
    shadowColor: BRAND_COLORS.graphite,
    shadows: [
      { blur: 16, offsetY: 12, opacity: 0.18 },
      { blur: 5, offsetY: 6, opacity: 0.3 },
      { blur: 1.2, offsetY: 1.5, opacity: 0.4 },
    ],
    contour: { color: BRAND_COLORS.graphite, opacity: 0.5, width: 3.5 },
    rimLight: { color: BRAND_COLORS.white, opacity: 0.85, offsetY: -2.5 },
  },
};

/** Machined graphite — the bot avatar surface: same family, the dark sibling. */
export const GRAPHITE_PLATE: PlateMaterial = {
  rim: [
    { offset: 0, color: METAL_TONES.aluminiumDeep },
    { offset: 0.14, color: METAL_TONES.gunmetal },
    { offset: 0.62, color: METAL_TONES.graphiteMid },
    { offset: 1, color: BRAND_COLORS.black },
  ],
  face: [
    { offset: 0, color: METAL_TONES.graphiteLift },
    { offset: 0.55, color: METAL_TONES.graphiteMid },
    { offset: 1, color: METAL_TONES.graphiteDeep },
  ],
  grain: { ...BRUSHED_METAL_GRAIN, seed: 41, opacity: 0.14 },
  sheen: [
    { offset: 0, color: BRAND_COLORS.white, opacity: 0 },
    { offset: 0.3, color: BRAND_COLORS.white, opacity: 0.07 },
    { offset: 0.52, color: BRAND_COLORS.white, opacity: 0 },
    { offset: 1, color: BRAND_COLORS.white, opacity: 0 },
  ],
  bevel: {
    width: 6,
    highlight: BRAND_COLORS.white,
    highlightOpacity: 0.28,
    shadow: BRAND_COLORS.black,
    shadowOpacity: 0.5,
  },
  edge: { color: BRAND_COLORS.black, opacity: 0.8, width: 2 },
  castShadow: {
    color: BRAND_COLORS.black,
    layers: [
      { blur: 12, offsetY: 10, opacity: 0.36 },
      { blur: 3, offsetY: 3, opacity: 0.3 },
    ],
  },
  emblemFinish: EMBLEM_FINISHES.metallic,
  emblemRelief: {
    shadowColor: BRAND_COLORS.black,
    shadows: [
      { blur: 16, offsetY: 12, opacity: 0.35 },
      { blur: 5, offsetY: 6, opacity: 0.5 },
      { blur: 1.2, offsetY: 1.5, opacity: 0.5 },
    ],
    contour: { color: BRAND_COLORS.black, opacity: 0.5, width: 3 },
    rimLight: { color: BRAND_COLORS.white, opacity: 0.3, offsetY: -2 },
  },
};

/** Room for the cast shadow's blur, relative to the plate size. */
const CAST_SHADOW_MARGIN_RATIO = 0.08;

/** Where the inner bevel's highlight has faded out, and where its shadow begins (fractions of height). */
const BEVEL_HIGHLIGHT_FALLOFF = 0.1;
const BEVEL_SHADOW_ONSET = 0.88;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly radius: number;
}

function rect(r: Rect, attributes: Readonly<Record<string, string | number>>): string {
  return el('rect', { x: r.x, y: r.y, width: r.size, height: r.size, rx: r.radius, ...attributes });
}

/** The plate rectangles for a layout: the outer plate and the inset face. */
export function plateGeometry(layout: PlateLayout): { plate: Rect; face: Rect } {
  const plate: Rect = {
    x: layout.inset,
    y: layout.inset,
    size: layout.size - 2 * layout.inset,
    radius: layout.cornerRadius,
  };
  const face: Rect = {
    x: plate.x + layout.rimWidth,
    y: plate.y + layout.rimWidth,
    size: plate.size - 2 * layout.rimWidth,
    radius: Math.max(0, plate.radius - layout.rimWidth),
  };
  return { plate, face };
}

function faceLayers(id: string, material: PlateMaterial, face: Rect): Fragment {
  const faceId = `${id}-face`;
  const clipId = `${id}-face-clip`;
  const grainId = `${id}-grain`;
  const sheenId = `${id}-sheen`;
  const bevelId = `${id}-bevel`;
  const { bevel } = material;
  const bevelStops: GradientStop[] = [
    { offset: 0, color: bevel.highlight, opacity: bevel.highlightOpacity },
    { offset: BEVEL_HIGHLIGHT_FALLOFF, color: bevel.highlight, opacity: 0 },
    { offset: BEVEL_SHADOW_ONSET, color: bevel.shadow, opacity: 0 },
    { offset: 1, color: bevel.shadow, opacity: bevel.shadowOpacity },
  ];
  return fragment(
    [
      linearGradient(faceId, VERTICAL, material.face),
      linearGradient(sheenId, DIAGONAL, material.sheen),
      linearGradient(bevelId, VERTICAL, bevelStops),
      brushedGrainFilter(grainId, material.grain),
      clipPath(clipId, rect(face, {})),
    ],
    [
      rect(face, { fill: url(faceId) }),
      el(
        'g',
        { 'clip-path': url(clipId) },
        rect(face, {
          fill: BRAND_COLORS.black,
          filter: url(grainId),
          opacity: material.grain.opacity,
        }),
        rect(face, { fill: url(sheenId) }),
        rect(face, { fill: 'none', stroke: url(bevelId), 'stroke-width': bevel.width * 2 }),
      ),
    ],
  );
}

function raisedPlateLayers(id: string, material: PlateMaterial, plate: Rect): Fragment {
  const shadowId = `${id}-cast`;
  const rimId = `${id}-rim`;
  return fragment(
    [
      shadowFilter(
        shadowId,
        material.castShadow.color,
        material.castShadow.layers,
        CAST_SHADOW_MARGIN_RATIO,
      ),
      linearGradient(rimId, VERTICAL, material.rim),
    ],
    [
      rect(plate, { fill: BRAND_COLORS.black, filter: url(shadowId) }),
      rect(plate, { fill: url(rimId) }),
    ],
  );
}

function edgeLayer(material: PlateMaterial, plate: Rect): Fragment {
  const inset = material.edge.width / 2;
  const edge: Rect = {
    x: plate.x + inset,
    y: plate.y + inset,
    size: plate.size - material.edge.width,
    radius: Math.max(0, plate.radius - inset),
  };
  return fragment(
    [],
    [
      rect(edge, {
        fill: 'none',
        stroke: material.edge.color,
        'stroke-opacity': material.edge.opacity,
        'stroke-width': material.edge.width,
      }),
    ],
  );
}

/**
 * A complete plate with the emblem. Full-bleed layouts (inset 0) skip the rim,
 * cast shadow and edge — the host (for example iOS) applies its own mask.
 */
export function plateArt(id: string, layout: PlateLayout, material: PlateMaterial): Fragment {
  const { plate, face } = plateGeometry(layout);
  const fullBleed = layout.inset === 0;
  const center = { x: layout.size / 2, y: layout.size / 2 - layout.emblemLift };
  const emblem = emblemArt({
    id: `${id}-emblem`,
    finish: material.emblemFinish,
    placement: placementCentered(center, layout.emblemRadius),
    relief: material.emblemRelief,
  });
  const surface = faceLayers(id, material, fullBleed ? plate : face);
  return fullBleed
    ? combine(surface, emblem)
    : combine(raisedPlateLayers(id, material, plate), surface, edgeLayer(material, plate), emblem);
}
