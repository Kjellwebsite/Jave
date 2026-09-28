'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Ambient, type CloudSpec } from '@/components/Ambient';
import { useCart } from '@/components/cart/CartProvider';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader, type NavItem } from '@/components/SiteHeader';
import { Tablet } from '@/components/Tablet';
import { TabletFace } from '@/components/TabletFace';
import { mix, withAlpha } from '@/lib/color';
import {
  getProduct,
  gradientStops,
  palette,
  PRODUCTS,
  productPath,
  type Product,
} from '@/lib/products';
import { motes } from '@/lib/random';
import { Blister } from './Blister';
import { Explainer } from './Explainer';
import { FlavorClouds } from './FlavorClouds';
import { Notices } from './Notices';
import { Reviews } from './Reviews';
import { RollingPrice } from './RollingPrice';

const NAV: NavItem[] = [
  { href: '#wirkstoffe', label: 'Wirkstoffe' },
  { href: '#einnahme', label: 'Einnahme' },
  { href: '/#faq', label: 'Fragen' },
];

/** Clouds around the tablet: prototype values in percent of their 900 x 820 px field. */
const CLOUDS: CloudSpec[] = [
  {
    left: '13.3%',
    top: '14.6%',
    width: '57.8%',
    height: '51.2%',
    color: 'rgba(255,255,255,0.42)',
    duration: 26,
  },
  {
    left: '42.2%',
    top: '7.3%',
    width: '51.1%',
    height: '46.3%',
    color: 'rgba(255,255,255,0.34)',
    duration: 30,
    delay: -8,
  },
  {
    left: '4.4%',
    top: '46.3%',
    width: '53.3%',
    height: '43.9%',
    color: 'rgba(255,240,248,0.34)',
    duration: 22,
    delay: -4,
  },
  {
    left: '46.7%',
    top: '46.3%',
    width: '48.9%',
    height: '48.8%',
    color: 'rgba(240,248,255,0.4)',
    duration: 28,
    delay: -12,
  },
  {
    left: '27.8%',
    top: '31.7%',
    width: '44.4%',
    height: '36.6%',
    color: 'rgba(255,255,255,0.5)',
    duration: 20,
    delay: -15,
  },
  {
    left: '62.2%',
    top: '24.4%',
    width: '33.3%',
    height: '31.7%',
    color: 'rgba(255,255,255,0.3)',
    duration: 25,
    delay: -6,
  },
];

const MOTES = motes(11, 44, 860, 780, 900, 820);

/** Swap animation classes alternate so the same elements replay their entrance. */
function swapClass(swaps: number, first: string, a: string, b: string): string {
  if (swaps === 0) return first;
  return swaps % 2 ? a : b;
}

/**
 * The prototype's page background (five stops over 2420 px) split in two, so the hero keeps its
 * dark part at any height and the sections below keep the light part.
 */
function heroBackground(product: Product): string {
  const [c0, c1, c2] = gradientStops(product.colors.bg_gradient);
  return `linear-gradient(180deg, ${c0} 0%, ${c1} var(--pp-c1), ${mix(c1!, c2!, 0.5726)} 100%)`;
}

function lowerBackground(product: Product): string {
  const [, c1, c2, c3, c4] = gradientStops(product.colors.bg_gradient);
  return `linear-gradient(180deg, ${mix(c1!, c2!, 0.5726)} 0px, ${c2} 145px, ${c3} 435px, ${c4} 1500px)`;
}

function ProductRail({ active }: { active: Product }) {
  return (
    <nav
      aria-label="Sortiment"
      className="rail flex flex-col items-center pt-3 pb-1 lg:pt-5 lg:pb-2"
    >
      <span className="hidden pb-3 text-center text-[12px] font-semibold opacity-85 lg:block">
        Sortiment
      </span>
      <ul className="grid w-full grid-cols-5 lg:grid-cols-1">
        {PRODUCTS.map((product) => {
          const on = product.slug === active.slug;
          return (
            <li key={product.slug} className="lg:border-t lg:border-white/16">
              <Link
                href={productPath(product)}
                scroll={false}
                aria-current={on ? 'page' : undefined}
                className="rail-item flex flex-col items-center gap-1.5 px-1 pt-1 pb-3 text-white lg:gap-2 lg:py-3.5"
                style={{ opacity: on ? 1 : 0.66 }}
              >
                <TabletFace
                  palette={palette(product)}
                  size={40}
                  edge={3}
                  drop="0 14px 18px rgba(10,5,40,0.35)"
                  outline={on ? '0 0 0 3px rgba(255,255,255,0.95)' : undefined}
                  className="mini lg:size-11!"
                />
                <span className="mt-1 flex flex-col items-center gap-px">
                  <span
                    className="text-[13px] lg:text-[14px]"
                    style={{ fontWeight: on ? 700 : 500 }}
                  >
                    {product.name}
                  </span>
                  <span className="hidden text-[11px] opacity-85 lg:block">{product.category}</span>
                </span>
                <span className="font-display text-[11px] font-bold lg:text-[13px]">
                  {product.price_eur} €
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function IngredientZoom({
  product,
  onClose,
  panelRef,
}: {
  product: Product;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={`Inhaltsstoffe von Lull ${product.name}`}
      className="zoom-panel"
    >
      <ul className="flex flex-col gap-7 pt-2 lg:block lg:pt-0">
        {product.ingredients.map((ingredient, k) => {
          const delay = 0.7 + (k % 2) * 0.2 + (k >= 2 ? 0.1 : 0);
          return (
            <li
              key={ingredient.name}
              className="zoom-item ingr-item"
              data-side={k < 2 ? 'left' : 'right'}
              data-row={k % 2}
              style={{ animationDelay: `${delay.toFixed(1)}s` }}
            >
              <span className="flex grow flex-col gap-1.5">
                <span className="font-display text-[15px] font-bold opacity-85">
                  {ingredient.dose}
                </span>
                <span className="font-serif text-[30px] leading-none lg:text-[34px]">
                  {ingredient.name}
                </span>
                <span className="text-[15px] leading-[1.45] opacity-90">{ingredient.note}</span>
              </span>
              <span
                aria-hidden="true"
                className="zoom-line ingr-line"
                style={{ animationDelay: `${(delay + 0.3).toFixed(1)}s` }}
              />
            </li>
          );
        })}
      </ul>
      <div
        className="zoom-close ingr-item mt-9 flex lg:mt-0 lg:justify-center"
        style={{ animationDelay: '1.4s' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost h-[52px] bg-[rgba(10,6,40,0.2)] px-[30px] text-[16px]"
        >
          Zurück zur Übersicht
        </button>
      </div>
    </div>
  );
}

function ProductScene({ product, showReviews }: { product: Product; showReviews: boolean }) {
  const cart = useCart();
  const [current, setCurrent] = useState(product.slug);
  const [swaps, setSwaps] = useState(0);
  const [pillSlug, setPillSlug] = useState(product.slug);
  const [zoom, setZoom] = useState(false);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const zoomedBefore = useRef(false);

  // Product switch (a rail link, back/forward): derived during render so the new copy and its
  // swap animation land in the same frame.
  if (current !== product.slug) {
    setCurrent(product.slug);
    setSwaps((n) => n + 1);
    setZoom(false);
  }

  // The tablet changes color mid-swap, while it is blurred out (the prototype's 450 ms).
  useEffect(() => {
    if (pillSlug === product.slug) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setPillSlug(product.slug), reduced ? 0 : 450);
    return () => window.clearTimeout(timer);
  }, [product.slug, pillSlug]);

  useEffect(() => {
    if (zoom) {
      zoomedBefore.current = true;
      panelRef.current?.focus({ preventScroll: true });
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setZoom(false);
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
    if (zoomedBefore.current) {
      zoomedBefore.current = false;
      zoomButtonRef.current?.focus({ preventScroll: true });
    }
  }, [zoom]);

  const pill = getProduct(pillSlug) ?? product;
  const text = swapClass(swaps, 'enter', 'swap-a', 'swap-b');
  const pillClass = swapClass(swaps, 'pill-intro', 'pill-swap-a', 'pill-swap-b');
  const { ink, button_ink: buttonInk, tablet_mid: mid } = product.colors;
  const line = withAlpha(ink, 0.18);
  const [headlineA, headlineB] = product.hero.headline;

  const order = () => {
    cart.add(product.slug);
    cart.open();
  };

  return (
    <main className={zoom ? 'pp is-zoom' : 'pp'}>
      <section className="pp-hero" aria-labelledby="pp-title">
        {PRODUCTS.map((p) => (
          <div
            key={p.slug}
            aria-hidden="true"
            className="bg-under pp-layer"
            style={{ background: heroBackground(p), opacity: p.slug === product.slug ? 1 : 0 }}
          />
        ))}
        <div aria-hidden="true" className="grain grain-under" />

        <div className="pp-header wrap-wide pt-4 lg:pt-0">
          <SiteHeader
            links={NAV}
            cta={
              <button
                type="button"
                onClick={order}
                className="btn btn-ghost h-11 px-[22px] text-base font-medium"
              >
                Bestellen
              </button>
            }
          />
        </div>

        <div className="pp-rail wrap-wide mt-4 lg:mt-0" inert={zoom}>
          <ProductRail active={product} />
        </div>

        <div className="pp-stage-box" aria-hidden="true">
          <div className="pp-stage">
            <Ambient clouds={CLOUDS} motes={MOTES} className="pp-clouds absolute" />
            {PRODUCTS.map((p) => (
              <div
                key={p.slug}
                className="pp-glow"
                style={{
                  background: `radial-gradient(closest-side, ${p.colors.glow}, rgba(255,255,255,0))`,
                  opacity: p.slug === product.slug ? 1 : 0,
                }}
              />
            ))}
            <div className="pp-shadow">
              <span
                style={{
                  width: '100%',
                  height: '91%',
                  background:
                    'radial-gradient(closest-side, rgba(20,10,60,0.42), rgba(20,10,60,0))',
                  filter: 'blur(14px)',
                }}
              />
              <span
                style={{
                  width: '63%',
                  height: '37%',
                  background: 'radial-gradient(closest-side, rgba(10,4,30,0.55), rgba(10,4,30,0))',
                  filter: 'blur(5px)',
                }}
              />
            </div>
            <div className="pp-tablet pill-float">
              <Tablet
                palette={palette(pill)}
                code={pill.name.toUpperCase()}
                layers={48}
                lite
                className={pillClass}
              />
            </div>
          </div>
        </div>

        <div className="pp-copy wrap-wide pb-16 lg:pb-12">
          <div className="pp-copy-cell">
            <div className="hero-copy flex flex-col gap-[22px] lg:gap-[26px]" inert={zoom}>
              <p
                className={`${text} m-0 flex flex-wrap items-center gap-x-3 gap-y-2 font-display text-[15px]`}
                style={{ animationDelay: '0.08s' }}
              >
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ background: mid, boxShadow: '0 0 0 3px rgba(255,255,255,0.4)' }}
                />
                <span className="font-bold tracking-[0.4px]">Lull {product.name}</span>
                <span className="opacity-80">{product.category}</span>
                {product.flavor && (
                  <span
                    className="flavor-chip"
                    style={{
                      background: `linear-gradient(90deg, ${product.flavor.colors[0]}cc, ${product.flavor.colors[1]}99)`,
                    }}
                  >
                    {product.flavor.name}
                  </span>
                )}
              </p>
              <h1
                id="pp-title"
                className={`${text} pp-title m-0 font-serif font-normal`}
                style={{ animationDelay: '0.15s' }}
              >
                {headlineA}
                <br />
                {headlineB}
              </h1>
              <p
                className={`${text} m-0 max-w-[480px] text-[18px] leading-[1.55] opacity-95 sm:text-[20px] lg:min-h-[93px]`}
                style={{ animationDelay: '0.28s' }}
              >
                {product.hero.subline}
              </p>
              <div
                className={`${text} flex flex-wrap items-end gap-x-[22px] gap-y-2`}
                style={{ animationDelay: '0.1s' }}
              >
                <RollingPrice price={product.price_eur} oldPrice={product.old_price_eur} />
                <div className="flex flex-col gap-1 pb-2.5" aria-hidden="true">
                  <span className="relative self-start font-display text-[16px] font-semibold opacity-75">
                    {product.old_price_eur} €
                    <span className="strike absolute top-1/2 left-0 h-0.5 w-full bg-white" />
                  </span>
                  <span className="text-[14px] opacity-90">14 Tabletten im Blister</span>
                </div>
              </div>
              <div
                className="enter flex flex-wrap items-center gap-3 sm:gap-4"
                style={{ animationDelay: '0.55s' }}
              >
                <button
                  type="button"
                  onClick={order}
                  className="btn btn-main h-14 px-8 text-[17px]"
                  style={{ color: buttonInk }}
                >
                  Jetzt bestellen
                </button>
                <button
                  ref={zoomButtonRef}
                  type="button"
                  aria-expanded={zoom}
                  onClick={() => setZoom(true)}
                  className="btn btn-ghost h-14 px-7 text-[17px]"
                >
                  Inhaltsstoffe ansehen
                </button>
              </div>
            </div>
            {zoom && (
              <IngredientZoom
                product={product}
                onClose={() => setZoom(false)}
                panelRef={panelRef}
              />
            )}
          </div>
        </div>
      </section>

      <div className="on-light relative flow-root">
        {PRODUCTS.map((p) => (
          <div
            key={p.slug}
            aria-hidden="true"
            className="bg-under pp-layer"
            style={{ background: lowerBackground(p), opacity: p.slug === product.slug ? 1 : 0 }}
          />
        ))}
        <div aria-hidden="true" className="grain grain-under" />

        <div className="wrap-wide ink-fade" style={{ color: ink, ['--focus' as string]: ink }}>
          <div aria-hidden="true" className="ink-fade h-px" style={{ background: line }} />

          <section
            aria-labelledby="blister-title"
            className="grid items-center gap-10 pt-12 pb-8 lg:grid-cols-[minmax(0,720px)_minmax(0,460px)] lg:gap-x-[70px] lg:pt-20 lg:pb-[30px]"
          >
            <div
              className={`${text} blister-area flex h-[min(340px,62cqw)] items-center justify-center lg:-ml-[30px] lg:h-[340px]`}
            >
              <Blister product={product} />
            </div>
            <div className={`${text} flex flex-col gap-[18px]`} style={{ animationDelay: '0.15s' }}>
              <h2
                id="blister-title"
                className="m-0 font-serif text-[42px] leading-[1.02] font-normal sm:text-[52px]"
              >
                14 Stück.
                <br />
                Einzeln versiegelt.
              </h2>
              <p className="m-0 text-[17px] leading-[1.6] sm:text-[18px]">
                Jede Tablette sitzt in ihrer eigenen Kammer, geschützt vor Licht und Feuchtigkeit.
                Der Blister passt flach in jede Jackentasche.
              </p>
              <p className="m-0 mt-1.5 flex items-baseline gap-2.5">
                <span className="font-display text-[30px] font-extrabold">
                  {product.price_eur} €
                </span>
                <span className="text-[15px] opacity-75">pro Blister</span>
              </p>
            </div>
          </section>

          <div aria-hidden="true" className="ink-fade h-px" style={{ background: line }} />

          <div
            id="wirkstoffe"
            className="grid gap-12 pt-12 pb-14 lg:grid-cols-3 lg:gap-[72px] lg:pt-[50px] lg:pb-[50px]"
          >
            <section className={`${text} flex flex-col gap-[18px]`} aria-labelledby="inhalt-title">
              <h2
                id="inhalt-title"
                className="m-0 font-serif text-[40px] leading-[1.1] font-normal"
              >
                Was drin ist
              </h2>
              <dl className="m-0 flex flex-col gap-2.5 text-[17px] leading-[1.5] tabular-nums">
                {product.ingredients.map((ingredient) => (
                  <div
                    key={ingredient.name}
                    className="ink-fade flex justify-between gap-4 border-b pb-2"
                    style={{ borderColor: line }}
                  >
                    <dt>{ingredient.name}</dt>
                    <dd className="m-0 whitespace-nowrap">{ingredient.dose}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section
              id="einnahme"
              className={`${text} flex flex-col gap-[18px]`}
              style={{ animationDelay: '0.1s' }}
              aria-labelledby="einnahme-title"
            >
              <h2
                id="einnahme-title"
                className="m-0 font-serif text-[40px] leading-[1.1] font-normal"
              >
                So nimmst du sie
              </h2>
              <p className="m-0 text-[17px] leading-[1.6]">{product.howto}</p>
            </section>
            <section
              className={`${text} flex flex-col gap-[18px]`}
              style={{ animationDelay: '0.2s' }}
              aria-labelledby="momente-title"
            >
              <h2
                id="momente-title"
                className="m-0 font-serif text-[40px] leading-[1.1] font-normal"
              >
                Für Momente wie
              </h2>
              <p className="m-0 text-[17px] leading-[1.6]">{product.moments}</p>
            </section>
          </div>
        </div>

        {product.flavor && <FlavorClouds flavor={product.flavor} ink={ink} textClass={text} />}

        <div className="wrap-wide ink-fade" style={{ color: ink, ['--focus' as string]: ink }}>
          {product.explainer && (
            <>
              {!product.flavor && (
                <div aria-hidden="true" className="ink-fade h-px" style={{ background: line }} />
              )}
              <Explainer product={product} copy={product.explainer} textClass={text} />
            </>
          )}

          <div aria-hidden="true" className="ink-fade h-px" style={{ background: line }} />
          <Notices product={product} textClass={text} />

          {showReviews && (
            <>
              <div aria-hidden="true" className="ink-fade h-px" style={{ background: line }} />
              <div className="pt-12 lg:pt-[60px]">
                <Reviews product={product} textClass={text} />
              </div>
            </>
          )}

          <SiteFooter className="ink-fade mt-20 pb-10 opacity-80 lg:mt-[100px]" />
        </div>
      </div>
    </main>
  );
}

/**
 * The product page lives in the shared `/produkte` layout, so switching products keeps this
 * component mounted: backgrounds crossfade, the tablet blurs out and back in, price digits roll.
 */
export function ProductExperience({ showReviews }: { showReviews: boolean }) {
  const segment = useSelectedLayoutSegment();
  const product = getProduct(segment);
  if (!product) return null;
  return <ProductScene product={product} showReviews={showReviews} />;
}
