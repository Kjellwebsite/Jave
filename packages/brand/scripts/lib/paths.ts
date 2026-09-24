/** Filesystem locations shared by the render scripts and the tests. */
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of `packages/brand`; manifest paths are relative to it. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Committed PNGs must stay small enough to live in the repository. */
export const PNG_BUDGET_BYTES = 6 * 1024 * 1024;

/** Visual review output (contact sheets); not a brand asset. */
export const PREVIEW_DIR = 'preview';

/** Absolute path of a file inside the package; refuses paths that escape it. */
export function packagePath(relativePath: string): string {
  const target = join(PACKAGE_ROOT, relativePath);
  const fromRoot = relative(PACKAGE_ROOT, target);
  if (isAbsolute(relativePath) || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new RangeError(`Path escapes the brand package: ${relativePath}`);
  }
  return target;
}
