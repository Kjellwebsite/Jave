import { describe, expect, it } from 'vitest';
import { loadBrandTypography } from '../../scripts/lib/brand-typography';
import { rasterize } from '../../scripts/lib/raster';
import { EMBLEM_ENCLOSING_CIRCLE, EMBLEM_POLYGONS } from '../emblem-metrics';
import { distance } from '../geometry';
import { emblemScale, placementCentered } from './emblem-art';
import { PADDED_PLATE_LAYOUT, PLATE_CANVAS, botAvatarSvg, serverIconSvg } from './icons';
import { plateGeometry } from './plates';
import { INVITE_SPLASH_SAFE_RIGHT, inviteSplashBrandExtent } from './scenes';

const CROP_RADIUS = PLATE_CANVAS / 2;
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
    expect(reach).toBeLessThan(CROP_RADIUS - 8);
  });

  it('keeps the whole emblem well inside the plate face and the crop circle', () => {
    const placement = placementCentered(
      { x: center.x, y: center.y - PADDED_PLATE_LAYOUT.emblemLift },
      PADDED_PLATE_LAYOUT.emblemRadius,
    );
    const scale = emblemScale(placement);
    const faceMargin = face.size * 0.1;
    for (const p of EMBLEM_POLYGONS.flat()) {
      const x = placement.center.x + (p.x - EMBLEM_ENCLOSING_CIRCLE.center.x) * scale;
      const y = placement.center.y + (p.y - EMBLEM_ENCLOSING_CIRCLE.center.y) * scale;
      expect(x).toBeGreaterThan(face.x + faceMargin * 0.5);
      expect(x).toBeLessThan(face.x + face.size - faceMargin * 0.5);
      expect(y).toBeGreaterThan(face.y + faceMargin);
      expect(y).toBeLessThan(face.y + face.size - faceMargin);
      expect(distance({ x, y }, center)).toBeLessThan(CROP_RADIUS * 0.72);
    }
  });

  it.each([
    ['server icon', serverIconSvg],
    ['bot avatar', botAvatarSvg],
  ])('%s leaves nothing but a faint shadow outside the crop circle', (_name, build) => {
    const size = 128;
    const image = rasterize(build(), size, size);
    const radius = size / 2;
    let maxOutside = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const outside = Math.hypot(x + 0.5 - radius, y + 0.5 - radius) > radius;
        if (outside) maxOutside = Math.max(maxOutside, image.data[(y * size + x) * 4 + ALPHA] ?? 0);
      }
    }
    expect(maxOutside / CHANNEL_MAX).toBeLessThan(0.12);
  });

  it('keeps both halves of the emblem distinct from the plate at 32px', () => {
    const size = 32;
    const image = rasterize(serverIconSvg(), size, size);
    const grey = (x: number, y: number): number => {
      const i = (y * size + x) * 4;
      return ((image.data[i] ?? 0) + (image.data[i + 1] ?? 0) + (image.data[i + 2] ?? 0)) / 3;
    };
    const column = (x: number): number[] => [12, 13, 14, 15].map((y) => grey(x, y));
    const plate = Math.max(...column(7));
    // Spear straddles the centre: lit facet at x = 15, shaded facet at x = 16.
    const minContrast = 25;
    expect(Math.min(...column(15))).toBeGreaterThan(plate + minContrast);
    expect(Math.max(...column(16))).toBeLessThan(Math.min(...column(7)) - minContrast);
  });
});

describe('invite splash', () => {
  it('keeps the brand block clear of the invite card and inside the frame', () => {
    const extent = inviteSplashBrandExtent(loadBrandTypography());
    expect(extent.left).toBeGreaterThan(32);
    expect(extent.right).toBeLessThanOrEqual(INVITE_SPLASH_SAFE_RIGHT);
  });
});
