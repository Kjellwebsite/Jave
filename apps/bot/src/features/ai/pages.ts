/**
 * Split long answers into embed-sized pages. Cuts prefer paragraph, then
 * line, then word boundaries, never split a surrogate pair, and keep code
 * fences balanced: a page that ends inside a ``` block closes it, and the next
 * page reopens it.
 */

/** Embed descriptions allow 4096 characters; leave room for fence repairs. */
export const PAGE_CHARS = 3800;
/** A boundary is used only if the page would still be at least this full. */
const MIN_PAGE_FILL = 0.5;
const FENCE = '```';
const FENCE_REOPEN = `${FENCE}\n`;
const FENCE_CLOSE = `\n${FENCE}`;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function cutPoint(text: string, budget: number): number {
  const floor = Math.floor(budget * MIN_PAGE_FILL);
  for (const boundary of ['\n\n', '\n', ' ']) {
    const at = text.lastIndexOf(boundary, budget);
    if (at >= floor) return at;
  }
  let cut = budget;
  if (isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  return cut;
}

function fenceCount(text: string): number {
  return text.split(FENCE).length - 1;
}

export function paginate(text: string, max: number = PAGE_CHARS): string[] {
  const pages: string[] = [];
  let rest = text.trim();
  let reopen = false;
  while (rest.length > 0) {
    const prefix: string = reopen ? FENCE_REOPEN : '';
    const budget = max - prefix.length - FENCE_CLOSE.length;
    let chunk: string;
    if (rest.length <= budget) {
      chunk = rest;
      rest = '';
    } else {
      const cut = cutPoint(rest, budget);
      chunk = rest.slice(0, cut).trimEnd();
      rest = rest.slice(cut).trimStart();
    }
    let page: string = `${prefix}${chunk}`;
    reopen = fenceCount(page) % 2 === 1;
    if (reopen) page += FENCE_CLOSE;
    pages.push(page);
  }
  return pages.length > 0 ? pages : [''];
}
