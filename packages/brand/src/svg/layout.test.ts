import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plateEmblemContrast } from '../../scripts/lib/legibility';
import { packagePath } from '../../scripts/lib/paths';
import { rasterize } from '../../scripts/lib/raster';
import { EMBLEM_ENCLOSING_CIRCLE, EMBLEM_POLYGONS } from '../emblem-metrics';
import { distance } from '../geometry';
import { BRAND_ASSETS } from '../manifest';
import { emblemScale } from './emblem-art';
import {
  PADDED_PLATE_LAYOUT,
  PLATE_CANVAS,
  PLATE_ICONS,
  botAvatarSvg,
  serverIconSvg,
  type PlateIconId,
} from './icons';
import { FIRST_RELEASE_SERVER_ICON } from './first-release.fixture';
import { plateArt, plateEmblemPlacement, plateGeometry } from './plates';
import { svgDocument } from './xml';

const CROP_RADIUS = PLATE_CANVAS / 2;
/** Least gap between the plate's farthest point and the crop circle, canvas px. */
const PLATE_CROP_CLEARANCE = 8;
/** The emblem stays within this fraction of the crop radius (README → Discord notes). */
const EMBLEM_MAX_CROP_FRACTION = 0.72;
/** Least margin between the emblem and the face edge, as a fraction of the face side. */
const FACE_MARGIN_FRACTION = 0.1;
/** Size the circle-crop check renders at. */
const CROP_CHECK_SIZE = 128;
/** Highest coverage allowed outside the crop circle (the soft cast shadow). */
const MAX_COVERAGE_OUTSIDE_CROP = 0.12;
const CHANNEL_MAX = 255;
const ALPHA = 3;

/** Farthest point of a centred rounded square from its centre. */
function roundedSquareReach(halfSide: number, cornerRadius: number): number {
  return (halfSide - cornerRadius) * Math.SQRT2 + cornerRadius;
}

describe('circle-safe icons', () => {
  const { plate, face } = plateGeometry(PADDED_PLATE_LAYOUT);
  const center = { x: PLATE_CANVAS / 2, y: PLATE_CANVAS / 2 };

  it('keeps the plate inside the circle Discord crops to', () => {
    const reach = roundedSquareReach(plate.size / 2, plate.radius);
    expect(reach).toBeLessThan(CROP_RADIUS - PLATE_CROP_CLEARANCE);
  });

  it('keeps the whole emblem well inside the plate face and the crop circle', () => {
    const placement = plateEmblemPlacement(PADDED_PLATE_LAYOUT);
    const scale = emblemScale(placement);
    const faceMargin = face.size * FACE_MARGIN_FRACTION;
    for (const p of EMBLEM_POLYGONS.flat()) {
      const x = placement.center.x + (p.x - EMBLEM_ENCLOSING_CIRCLE.center.x) * scale;
      const y = placement.center.y + (p.y - EMBLEM_ENCLOSING_CIRCLE.center.y) * scale;
      expect(x).toBeGreaterThan(face.x + faceMargin * 0.5);
      expect(x).toBeLessThan(face.x + face.size - faceMargin * 0.5);
      expect(y).toBeGreaterThan(face.y + faceMargin);
      expect(y).toBeLessThan(face.y + face.size - faceMargin);
      expect(distance({ x, y }, center)).toBeLessThan(CROP_RADIUS * EMBLEM_MAX_CROP_FRACTION);
    }
  });

  it.each([
    ['server icon', serverIconSvg],
    ['bot avatar', botAvatarSvg],
  ])('%s leaves nothing but a faint shadow outside the crop circle', (_name, build) => {
    const size = CROP_CHECK_SIZE;
    const image = rasterize(build(), size, size);
    const radius = size / 2;
    let maxOutside = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const outside = Math.hypot(x + 0.5 - radius, y + 0.5 - radius) > radius;
        if (outside) maxOutside = Math.max(maxOutside, image.data[(y * size + x) * 4 + ALPHA] ?? 0);
      }
    }
    expect(maxOutside / CHANNEL_MAX).toBeLessThan(MAX_COVERAGE_OUTSIDE_CROP);
  });
});

/**
 * Discord shows server icons and avatars down to 16 px (folder previews,
 * compact lists). At every such size, the worst pixel of each half of the
 * emblem must move at least this many 8-bit luma levels off the bare plate.
 */
const MIN_EMBLEM_CONTRAST = 30;
/** Each half must dominate at least this many pixels, so the check cannot pass vacuously. */
const MIN_DOMINANT_PIXELS = 4;
const SMALL_SIZES = [16, 32] as const;

function committedSvg(id: PlateIconId): string {
  return readFileSync(packagePath(BRAND_ASSETS[id].svg), 'utf8');
}

describe('small-size legibility', () => {
  const cases = (['server-icon', 'bot-avatar'] as const).flatMap((id) =>
    SMALL_SIZES.map((size) => [id, size] as const),
  );

  it.each(cases)('%s: both halves of the emblem stand off the plate at %ipx', (id, size) => {
    const contrast = plateEmblemContrast(committedSvg(id), PLATE_ICONS[id], size);
    for (const half of [contrast.lit, contrast.shade]) {
      expect(half.pixels).toBeGreaterThanOrEqual(MIN_DOMINANT_PIXELS);
      expect(half.min).toBeGreaterThanOrEqual(MIN_EMBLEM_CONTRAST);
    }
  });

  it('BREAK: rejects the first release’s silver-on-silver finish that vanished at 16px', () => {
    const { layout, material } = FIRST_RELEASE_SERVER_ICON;
    const svg = svgDocument({
      width: PLATE_CANVAS,
      height: PLATE_CANVAS,
      title: 'first release',
      content: plateArt('first', layout, material),
    });
    const contrast = plateEmblemContrast(svg, FIRST_RELEASE_SERVER_ICON, SMALL_SIZES[0]);
    expect(Math.min(contrast.lit.min, contrast.shade.min)).toBeLessThan(MIN_EMBLEM_CONTRAST);
  });
});
