import raw from '@/data/products.json';
import { isHexColor } from './color';
import { parseEuroCents } from './price';
import type { TabletPalette } from './tablet';

/**
 * Product data, extracted from the design prototype into `data/products.json`.
 * The JSON is validated once at import so a broken edit fails the build, not a page.
 * Later this can move to a CMS or Supabase behind the same functions.
 */

/** The three goals of a sleep formula, the columns of the release matrix. */
export type PhaseId = 'einschlafen' | 'durchschlafen' | 'aufwachen';
export const PHASE_IDS: readonly PhaseId[] = ['einschlafen', 'durchschlafen', 'aufwachen'];

/** A published effect with its 95 % confidence interval, e.g. minutes of sleep latency. */
export interface Effect {
  label: string;
  value: number;
  low: number;
  high: number;
  unit: string;
}

/** The best study behind an ingredient. Studies used the single ingredient, not the product. */
export interface Evidence {
  /** 3 meta-analysis in humans, 2 randomized controlled trial in humans, 1 animal study. */
  level: 1 | 2 | 3;
  kind: string;
  finding: string;
  source: string;
  url: string;
  effects?: Effect[];
}

export interface IngredientRole {
  phase: PhaseId;
  text: string;
  /** The text is an authorized EU health claim (Regulation (EU) No 432/2012). */
  claim?: boolean;
}

export interface Ingredient {
  name: string;
  dose: string;
  /** Mechanism, shown in the ingredient zoom on the product page. */
  note: string;
  /** Release matrix only: the tablet layer that carries it, 0 is the top. */
  layer?: number;
  roles?: IngredientRole[];
  evidence?: Evidence;
}

export interface Review {
  title: string;
  text: string;
  name: string;
  /** Stars, 1 to 5. */
  r: number;
  since: string;
}

/** INVENTED in the prototype. Never shown in production, see `lib/launch.ts`. */
export interface PlaceholderRating {
  avg: string;
  count: string;
  distribution_5_to_1_percent: number[];
  reviews: Review[];
}

export interface ProductColors {
  bg_gradient: string;
  ink: string;
  button_ink: string;
  glow: string;
  tablet_bottom: string;
  tablet_mid: string;
  tablet_top_blush: string;
  card_stops: [string, string, string];
}

/** Taste of the tablet, shown with a band of clouds in its colors. */
export interface Flavor {
  name: string;
  note: string;
  /** Deep, middle and light tint of the artwork, #rrggbb. */
  colors: [string, string, string];
  /** Artwork of the band: drifting clouds (default) or a night sky with a moon. */
  scene?: 'clouds' | 'moon';
}

/** Copy of the mechanism explainer and its graphic (tense vs. calmer nervous system). */
export interface Explainer {
  eyebrow: string;
  title: string;
  lead: string;
  /** Labels of the two states in the graphic. */
  busy: string;
  calm: string;
}

export interface ReleaseLayer {
  name: string;
  text: string;
  /** Release window in hours after intake. Omitted for a layer without actives. */
  start?: number;
  end?: number;
}

/** "Double release": which layer releases when, and what each ingredient does per phase. */
export interface ReleaseMatrix {
  eyebrow: string;
  title: string;
  lead: string;
  /** Three pressed layers, top to bottom. */
  layers: ReleaseLayer[];
  /** One entry per phase, in the order of `PHASE_IDS`. */
  phases: { id: PhaseId; title: string; text: string }[];
  /** Elimination half-life used for the "wake up clear" chart. */
  halfLife: { ingredient: string; minutes: number; source: string; url: string };
  /** Disclaimer under the section. */
  note: string;
}

export interface Product {
  slug: string;
  name: string;
  category: string;
  price_eur: string;
  old_price_eur: string;
  pack: string;
  hero: { headline: [string, string]; subline: string };
  finder: { prompt: string; pitch: string; when: string; targets: string[] };
  card_blurb: string;
  colors: ProductColors;
  ingredients: Ingredient[];
  howto: string;
  moments: string;
  flavor?: Flavor;
  explainer?: Explainer;
  release?: ReleaseMatrix;
  /** Product-specific warnings, shown with the mandatory supplement notices. */
  warnings?: string[];
  rating_PLACEHOLDER: PlaceholderRating;
}

type Json = Record<string, unknown>;

function fail(where: string, message: string): never {
  throw new Error(`data/products.json ${where}: ${message}`);
}

function object(value: unknown, where: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'expected an object');
  }
  return value as Json;
}

function text(o: Json, key: string, where: string): string {
  const value = o[key];
  if (typeof value !== 'string' || value.trim() === '') fail(`${where}.${key}`, 'expected text');
  return value;
}

function list(o: Json, key: string, where: string): unknown[] {
  const value = o[key];
  if (!Array.isArray(value)) fail(`${where}.${key}`, 'expected a list');
  return value;
}

function num(o: Json, key: string, where: string): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${where}.${key}`, 'expected a number');
  return value;
}

function url(o: Json, key: string, where: string): string {
  const value = text(o, key, where);
  if (!/^https:\/\/\S+$/.test(value))
    fail(`${where}.${key}`, `expected an https link, got "${value}"`);
  return value;
}

function parseIngredient(value: unknown, where: string): void {
  const ingredient = object(value, where);
  for (const key of ['name', 'dose', 'note']) text(ingredient, key, where);
  if (ingredient.layer !== undefined) {
    const layer = num(ingredient, 'layer', where);
    if (!Number.isInteger(layer) || layer < 0) fail(`${where}.layer`, 'expected a layer index');
  }
  if (ingredient.roles !== undefined) {
    list(ingredient, 'roles', where).forEach((item, i) => {
      const role = object(item, `${where}.roles[${i}]`);
      const phase = text(role, 'phase', `${where}.roles[${i}]`);
      if (!PHASE_IDS.includes(phase as PhaseId)) {
        fail(`${where}.roles[${i}].phase`, `unknown phase "${phase}"`);
      }
      text(role, 'text', `${where}.roles[${i}]`);
      if (role.claim !== undefined && typeof role.claim !== 'boolean') {
        fail(`${where}.roles[${i}].claim`, 'expected true or false');
      }
    });
  }
  if (ingredient.evidence !== undefined) {
    const at = `${where}.evidence`;
    const evidence = object(ingredient.evidence, at);
    const level = num(evidence, 'level', at);
    if (![1, 2, 3].includes(level)) fail(`${at}.level`, 'expected 1, 2 or 3');
    for (const key of ['kind', 'finding', 'source']) text(evidence, key, at);
    url(evidence, 'url', at);
    if (evidence.effects !== undefined) {
      list(evidence, 'effects', at).forEach((item, i) => {
        const effect = object(item, `${at}.effects[${i}]`);
        text(effect, 'label', `${at}.effects[${i}]`);
        text(effect, 'unit', `${at}.effects[${i}]`);
        const [low, mid, high] = ['low', 'value', 'high'].map((key) =>
          num(effect, key, `${at}.effects[${i}]`),
        );
        if (!(low! <= mid! && mid! <= high!)) {
          fail(`${at}.effects[${i}]`, 'expected low <= value <= high');
        }
      });
    }
  }
}

function parseRelease(value: unknown, where: string, ingredients: Json[]): void {
  const release = object(value, where);
  for (const key of ['eyebrow', 'title', 'lead', 'note']) text(release, key, where);

  const layers = list(release, 'layers', where);
  if (layers.length !== 3) fail(`${where}.layers`, 'expected three layers, top to bottom');
  const windows = layers.map((item, i) => {
    const layer = object(item, `${where}.layers[${i}]`);
    for (const key of ['name', 'text']) text(layer, key, `${where}.layers[${i}]`);
    if (layer.start === undefined && layer.end === undefined) return false;
    const start = num(layer, 'start', `${where}.layers[${i}]`);
    const end = num(layer, 'end', `${where}.layers[${i}]`);
    if (!(start >= 0 && start < end && end <= 8)) {
      fail(`${where}.layers[${i}]`, 'expected 0 <= start < end <= 8 hours');
    }
    return true;
  });
  if (!windows[0] || !windows[1])
    fail(`${where}.layers`, 'the top two layers need a release window');

  const phases = list(release, 'phases', where);
  if (phases.length !== PHASE_IDS.length) fail(`${where}.phases`, 'expected one entry per phase');
  phases.forEach((item, i) => {
    const phase = object(item, `${where}.phases[${i}]`);
    if (phase.id !== PHASE_IDS[i]) fail(`${where}.phases[${i}].id`, `expected "${PHASE_IDS[i]}"`);
    for (const key of ['title', 'text']) text(phase, key, `${where}.phases[${i}]`);
  });

  const halfLife = object(release.halfLife, `${where}.halfLife`);
  const name = text(halfLife, 'ingredient', `${where}.halfLife`);
  if (!ingredients.some((ingredient) => ingredient.name === name)) {
    fail(`${where}.halfLife.ingredient`, `"${name}" is not an ingredient`);
  }
  if (num(halfLife, 'minutes', `${where}.halfLife`) <= 0) {
    fail(`${where}.halfLife.minutes`, 'expected a positive number');
  }
  text(halfLife, 'source', `${where}.halfLife`);
  url(halfLife, 'url', `${where}.halfLife`);

  ingredients.forEach((ingredient, i) => {
    const layer = ingredient.layer;
    if (typeof layer !== 'number' || !windows[layer]) {
      fail(
        `${where.replace(/\.release$/, '')}.ingredients[${i}].layer`,
        'every ingredient needs a layer with a release window',
      );
    }
  });
}

function color(o: Json, key: string, where: string): string {
  const value = text(o, key, where);
  if (!isHexColor(value)) fail(`${where}.${key}`, `expected #rrggbb, got "${value}"`);
  return value;
}

function parseProduct(value: unknown, index: number): Product {
  const where = `[${index}]`;
  const p = object(value, where);
  const slug = text(p, 'slug', where);
  if (!/^[a-z0-9-]+$/.test(slug)) fail(`${where}.slug`, `not URL-safe: "${slug}"`);
  for (const key of ['price_eur', 'old_price_eur']) parseEuroCents(text(p, key, where));

  const hero = object(p.hero, `${where}.hero`);
  const headline = list(hero, 'headline', `${where}.hero`);
  if (headline.length !== 2 || headline.some((line) => typeof line !== 'string')) {
    fail(`${where}.hero.headline`, 'expected two lines');
  }
  text(hero, 'subline', `${where}.hero`);

  const finder = object(p.finder, `${where}.finder`);
  for (const key of ['prompt', 'pitch', 'when']) text(finder, key, `${where}.finder`);
  list(finder, 'targets', `${where}.finder`);

  const colors = object(p.colors, `${where}.colors`);
  for (const key of ['ink', 'button_ink', 'tablet_bottom', 'tablet_mid', 'tablet_top_blush']) {
    color(colors, key, `${where}.colors`);
  }
  if (gradientStops(text(colors, 'bg_gradient', `${where}.colors`)).length !== 5) {
    fail(`${where}.colors.bg_gradient`, 'expected five #rrggbb stops');
  }
  const stops = list(colors, 'card_stops', `${where}.colors`);
  if (stops.length !== 3 || stops.some((s) => typeof s !== 'string' || !isHexColor(s))) {
    fail(`${where}.colors.card_stops`, 'expected three #rrggbb colors');
  }

  const ingredients = list(p, 'ingredients', where);
  if (ingredients.length !== 4) fail(`${where}.ingredients`, 'the design expects four');
  ingredients.forEach((item, i) => parseIngredient(item, `${where}.ingredients[${i}]`));

  for (const key of ['name', 'category', 'pack', 'card_blurb', 'howto', 'moments']) {
    text(p, key, where);
  }

  if (p.flavor !== undefined) {
    const flavor = object(p.flavor, `${where}.flavor`);
    for (const key of ['name', 'note']) text(flavor, key, `${where}.flavor`);
    const tints = list(flavor, 'colors', `${where}.flavor`);
    if (tints.length !== 3 || tints.some((c) => typeof c !== 'string' || !isHexColor(c))) {
      fail(`${where}.flavor.colors`, 'expected three #rrggbb colors');
    }
    if (flavor.scene !== undefined && flavor.scene !== 'clouds' && flavor.scene !== 'moon') {
      fail(`${where}.flavor.scene`, 'expected "clouds" or "moon"');
    }
  }
  if (p.explainer !== undefined) {
    const explainer = object(p.explainer, `${where}.explainer`);
    for (const key of ['eyebrow', 'title', 'lead', 'busy', 'calm']) {
      text(explainer, key, `${where}.explainer`);
    }
  }
  if (p.release !== undefined) {
    parseRelease(p.release, `${where}.release`, ingredients as Json[]);
  }
  if (p.warnings !== undefined) {
    const warnings = list(p, 'warnings', where);
    if (warnings.some((w) => typeof w !== 'string' || w.trim() === '')) {
      fail(`${where}.warnings`, 'expected a list of texts');
    }
  }

  const rating = object(p.rating_PLACEHOLDER, `${where}.rating_PLACEHOLDER`);
  if (list(rating, 'distribution_5_to_1_percent', `${where}.rating_PLACEHOLDER`).length !== 5) {
    fail(`${where}.rating_PLACEHOLDER.distribution_5_to_1_percent`, 'expected five values');
  }
  list(rating, 'reviews', `${where}.rating_PLACEHOLDER`);

  return p as unknown as Product;
}

/** The five `#rrggbb` stops of a product's `bg_gradient`, top to bottom. */
export function gradientStops(gradient: string): string[] {
  return gradient.match(/#[0-9a-f]{6}\b/gi) ?? [];
}

/** Validates the product list, throwing with the path of the first broken field. */
export function parseProducts(value: unknown): Product[] {
  if (!Array.isArray(value)) fail('', 'expected a list of products');
  const products = value.map(parseProduct);
  const slugs = new Set(products.map((p) => p.slug));
  if (slugs.size !== products.length) fail('', 'duplicate slugs');
  return products;
}

export const PRODUCTS: readonly Product[] = parseProducts(raw);

export const DEFAULT_PRODUCT = PRODUCTS[0]!;

export function getProduct(slug: string | null | undefined): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function productIndex(slug: string): number {
  return PRODUCTS.findIndex((p) => p.slug === slug);
}

export function productPath(product: Pick<Product, 'slug'>): `/produkte/${string}` {
  return `/produkte/${product.slug}`;
}

export function palette(product: Product): TabletPalette {
  return {
    bottom: product.colors.tablet_bottom,
    mid: product.colors.tablet_mid,
    blush: product.colors.tablet_top_blush,
  };
}

export function priceCents(product: Product): number {
  return parseEuroCents(product.price_eur);
}

/** Every ingredient across all products, in order, e.g. for the marquee. */
export function allIngredients(): { ingredient: Ingredient; product: Product }[] {
  return PRODUCTS.flatMap((product) =>
    product.ingredients.map((ingredient) => ({ ingredient, product })),
  );
}

/** Distinct active ingredients (L-Theanin and Safranextrakt appear twice). */
export function distinctIngredientCount(): number {
  return new Set(allIngredients().map(({ ingredient }) => ingredient.name)).size;
}
