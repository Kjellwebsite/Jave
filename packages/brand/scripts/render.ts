/**
 * Renders the JAVELIN brand kit: every SVG source in `assets/svg` and every PNG
 * in `assets/png`, exactly as listed in `src/manifest.ts`.
 *
 *   pnpm --filter @jave/brand render              # everything
 *   pnpm --filter @jave/brand render server-icon  # selected assets only
 *
 * Output is deterministic: same sources, same bytes.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BRAND_ASSETS, BRAND_ASSET_IDS, type BrandAssetId } from '../src/manifest';
import { buildBrandSvgs } from '../src/svg/catalog';
import { loadBrandTypography } from './lib/brand-typography';
import { PNG_BUDGET_BYTES, packagePath } from './lib/paths';
import { encodePng } from './lib/png';
import { rasterizeSizes } from './lib/raster';

const BYTES_PER_KIB = 1024;

function isAssetId(value: string): value is BrandAssetId {
  return (BRAND_ASSET_IDS as readonly string[]).includes(value);
}

function selectedIds(args: readonly string[]): BrandAssetId[] {
  if (args.length === 0) return [...BRAND_ASSET_IDS];
  const unknown = args.filter((arg) => !isAssetId(arg));
  if (unknown.length > 0) {
    throw new RangeError(
      `Unknown asset id(s): ${unknown.join(', ')}. Known: ${BRAND_ASSET_IDS.join(', ')}`,
    );
  }
  return args.filter(isAssetId);
}

function write(relativePath: string, contents: string | Buffer): number {
  const target = packagePath(relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return Buffer.byteLength(contents);
}

function kib(bytes: number): string {
  return `${(bytes / BYTES_PER_KIB).toFixed(1)} KiB`;
}

function totalPngBytes(): number {
  return BRAND_ASSET_IDS.flatMap((id) => BRAND_ASSETS[id].rasters).reduce((total, raster) => {
    try {
      return total + statSync(packagePath(raster.path)).size;
    } catch {
      return total;
    }
  }, 0);
}

function main(args: readonly string[]): void {
  const ids = selectedIds(args);
  const svgs = buildBrandSvgs(loadBrandTypography());
  for (const id of ids) {
    const asset = BRAND_ASSETS[id];
    const svg = svgs[id];
    console.log(`${asset.svg}  ${kib(write(asset.svg, svg))}`);
    if (asset.rasters.length === 0) continue;
    const images = rasterizeSizes(svg, asset.rasters);
    asset.rasters.forEach((raster, index) => {
      const image = images[index];
      if (!image) throw new Error(`Missing render for ${raster.path}.`);
      console.log(`${raster.path}  ${kib(write(raster.path, encodePng(image)))}`);
    });
  }
  const total = totalPngBytes();
  console.log(`PNG total: ${kib(total)} (budget ${kib(PNG_BUDGET_BYTES)})`);
  if (total > PNG_BUDGET_BYTES) {
    console.error('PNG output exceeds the repository budget.');
    process.exitCode = 1;
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
