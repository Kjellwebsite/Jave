import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadBrandTypography } from '../scripts/lib/brand-typography';
import { PNG_BUDGET_BYTES, packagePath } from '../scripts/lib/paths';
import { readPngHeader } from '../scripts/lib/png';
import { auditSvgPaint } from '../scripts/lib/svg-audit';
import { BRAND_ACCENTS, BRAND_COLORS, METAL_TONES } from './colors';
import {
  BRAND_ASSETS,
  BRAND_ASSET_IDS,
  BRAND_PACKAGE_NAME,
  BRAND_TARGETS,
  brandAssetModuleId,
  brandAssetPaths,
  rasterPath,
} from './manifest';
import { buildBrandSvgs } from './svg/catalog';

const ASSET_DIRS = ['assets/svg', 'assets/png'] as const;

function read(path: string): Buffer {
  return readFileSync(packagePath(path));
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(collectStrings);
  return [];
}

describe('manifest', () => {
  it('references files that exist', () => {
    const missing = brandAssetPaths().filter((path) => !existsSync(packagePath(path)));
    expect(missing).toEqual([]);
  });

  it('lists every committed asset (no stale files)', () => {
    const committed = ASSET_DIRS.flatMap((dir) =>
      readdirSync(packagePath(dir)).map((file) => `${dir}/${file}`),
    );
    expect(committed.sort()).toEqual(brandAssetPaths().sort());
  });

  it('points every delivery target at a manifest file', () => {
    const paths = new Set(brandAssetPaths());
    for (const target of collectStrings(BRAND_TARGETS)) expect(paths.has(target)).toBe(true);
  });

  it('resolves module ids only for manifest paths', () => {
    expect(brandAssetModuleId(BRAND_TARGETS.web.ogImage)).toBe(
      `${BRAND_PACKAGE_NAME}/assets/png/og-image-1200x630.png`,
    );
    for (const hostile of ['../package.json', 'assets/../../../etc/passwd', 'src/index.ts', '']) {
      expect(() => brandAssetModuleId(hostile)).toThrow(RangeError);
    }
    expect(() => rasterPath('server-icon', 999)).toThrow(RangeError);
  });

  it.each(BRAND_ASSET_IDS)('%s renders match their declared sizes', (id) => {
    for (const raster of BRAND_ASSETS[id].rasters) {
      const header = readPngHeader(read(raster.path));
      expect({ width: header.width, height: header.height }).toEqual({
        width: raster.width,
        height: raster.height,
      });
    }
  });

  it('keeps transparent icons transparent and scenes opaque', () => {
    const transparent = ['server-icon', 'bot-avatar', 'emblem', 'role-founder'] as const;
    for (const id of transparent) {
      for (const raster of BRAND_ASSETS[id].rasters)
        expect(readPngHeader(read(raster.path)).hasAlpha).toBe(true);
    }
    for (const id of ['server-banner', 'invite-splash', 'og-image', 'apple-touch-icon'] as const) {
      for (const raster of BRAND_ASSETS[id].rasters)
        expect(readPngHeader(read(raster.path)).hasAlpha).toBe(false);
    }
  });

  it('stays inside the repository PNG budget', () => {
    const total = BRAND_ASSET_IDS.flatMap((id) => BRAND_ASSETS[id].rasters).reduce(
      (sum, raster) => sum + statSync(packagePath(raster.path)).size,
      0,
    );
    expect(total).toBeLessThan(PNG_BUDGET_BYTES);
  });

  it('meets Discord upload limits', () => {
    const roleIconMaxBytes = 256 * 1024;
    for (const path of Object.values(BRAND_TARGETS.discord.roleIcons)) {
      expect(statSync(packagePath(path)).size).toBeLessThan(roleIconMaxBytes);
    }
    const imageMaxBytes = 8 * 1024 * 1024;
    for (const path of [
      BRAND_TARGETS.discord.serverIcon,
      BRAND_TARGETS.discord.serverBanner,
      BRAND_TARGETS.discord.inviteSplash,
      BRAND_TARGETS.discord.botAvatar,
    ]) {
      expect(statSync(packagePath(path)).size).toBeLessThan(imageMaxBytes);
    }
  });
});

describe('svg sources', () => {
  let built: Record<string, string>;
  beforeAll(() => {
    built = buildBrandSvgs(loadBrandTypography());
  });

  it('are exactly what the render pipeline produces (re-run `pnpm render` after edits)', () => {
    for (const id of BRAND_ASSET_IDS) {
      expect(read(BRAND_ASSETS[id].svg).toString('utf8'), id).toBe(built[id]);
    }
  });

  it.each(BRAND_ASSET_IDS)('%s parses and has the aspect of its renders', (id) => {
    const tree = new Resvg(read(BRAND_ASSETS[id].svg), { font: { loadSystemFonts: false } });
    for (const raster of BRAND_ASSETS[id].rasters) {
      expect(tree.width / tree.height).toBeCloseTo(raster.width / raster.height, 6);
    }
  });

  it('contain no script, event handlers, live text or external references', () => {
    for (const id of BRAND_ASSET_IDS) {
      const svg = read(BRAND_ASSETS[id].svg).toString('utf8');
      expect(svg, id).not.toMatch(
        /<script|<foreignObject|<text[\s>]|<image|\son[a-z]+=|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i,
      );
    }
  });

  it('use only palette colours (no neon, no purple, no strays)', () => {
    const palette = new Set(
      [
        ...Object.values(BRAND_COLORS),
        ...Object.values(BRAND_ACCENTS),
        ...Object.values(METAL_TONES),
      ].map((c) => c.toUpperCase()),
    );
    for (const id of BRAND_ASSET_IDS) {
      expect(auditSvgPaint(read(BRAND_ASSETS[id].svg).toString('utf8'), palette), id).toEqual([]);
    }
  });

  it('use currentColor, and no other colour, for the monochrome variants', () => {
    const noColours = new Set<string>();
    for (const id of ['emblem-mono', 'wordmark-mono'] as const) {
      const svg = read(BRAND_ASSETS[id].svg).toString('utf8');
      expect(svg).toContain('fill="currentColor"');
      expect(auditSvgPaint(svg, noColours), id).toEqual([]);
    }
  });
});

describe('fonts', () => {
  it('ships the OFL licence with every committed font', () => {
    const files = readdirSync(packagePath('fonts'));
    expect(files).toContain('OFL.txt');
    expect(files.filter((file) => file.endsWith('.ttf')).length).toBeGreaterThan(0);
    expect(readFileSync(join(packagePath('fonts'), 'OFL.txt'), 'utf8')).toContain(
      'SIL OPEN FONT LICENSE',
    );
  });
});
