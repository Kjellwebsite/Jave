'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Reveal } from '@/components/Reveal';
import { TabletFace } from '@/components/TabletFace';
import { mix } from '@/lib/color';
import { palette, PRODUCTS, productPath, type Product } from '@/lib/products';

function panelBackground(product: Product): string {
  const [light, mid, dark] = product.colors.card_stops;
  return `linear-gradient(135deg, ${dark} 0%, ${mid} 72%, ${mix(mid, light, 0.4)} 100%)`;
}

/**
 * "Finde deine Tablette": five answers as a radio group (arrow keys move and select), the panel
 * crossfades to the product's colors and the match below is announced politely.
 */
export function Finder() {
  const [pick, setPick] = useState(0);
  const [swaps, setSwaps] = useState(0);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const match = PRODUCTS[pick]!;

  function choose(index: number, focus = false) {
    if (index !== pick) {
      setPick(index);
      setSwaps((n) => n + 1);
    }
    if (focus) chipRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PRODUCTS.length - 1;
    const next: Record<string, number> = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowRight: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    choose(target, true);
  }

  return (
    <Reveal
      as="section"
      id="finder"
      aria-labelledby="finder-title"
      className="wrap finder mt-14 text-white lg:min-h-[600px]"
    >
      {PRODUCTS.map((product, i) => (
        <div
          key={product.slug}
          aria-hidden="true"
          className="finder-layer"
          style={{ background: panelBackground(product), opacity: i === pick ? 1 : 0 }}
        />
      ))}
      <div
        aria-hidden="true"
        className="finder-layer"
        style={{
          background:
            'radial-gradient(700px circle at 78% 30%, rgba(255,255,255,0.16), rgba(255,255,255,0) 60%), linear-gradient(180deg, rgba(10,5,30,0.05), rgba(10,5,30,0.28))',
        }}
      />
      <div aria-hidden="true" className="grain grain-under" />

      <div className="grid gap-12 px-5 py-9 sm:px-10 sm:py-12 lg:grid-cols-[minmax(0,480px)_minmax(0,500px)] lg:gap-x-24 lg:px-16 lg:py-[60px]">
        <div className="flex flex-col gap-3.5">
          <h2
            id="finder-title"
            className="m-0 font-serif text-[44px] leading-none font-normal sm:text-[60px]"
          >
            Finde deine Tablette
          </h2>
          <p id="finder-hint" className="m-0 mb-3 text-[17px] leading-[1.5] opacity-90">
            Was passt gerade am ehesten?
          </p>
          <div
            role="radiogroup"
            aria-labelledby="finder-title"
            aria-describedby="finder-hint"
            className="flex flex-col gap-3.5"
          >
            {PRODUCTS.map((product, i) => {
              const on = i === pick;
              return (
                <button
                  key={product.slug}
                  ref={(el) => {
                    chipRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => choose(i)}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  className="chip flex min-h-[58px] w-full max-w-[460px] items-center justify-between gap-4 rounded-[29px] px-[22px] py-3 text-left text-[16px] font-semibold sm:text-[17px]"
                  style={{
                    background: on ? '#ffffff' : 'rgba(255,255,255,0.1)',
                    color: on ? product.colors.button_ink : '#ffffff',
                    border: `1.5px solid ${on ? '#ffffff' : 'rgba(255,255,255,0.35)'}`,
                  }}
                >
                  <span>{product.finder.prompt}</span>
                  <span
                    aria-hidden="true"
                    className="size-3.5 shrink-0 rounded-full"
                    style={{
                      background: product.colors.tablet_mid,
                      boxShadow: `0 2px 0 ${product.colors.tablet_bottom}`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div aria-live="polite" aria-atomic="true">
          <div
            key={pick}
            className={['flex flex-col gap-[18px]', swaps > 0 ? 'swap-blur' : ''].join(' ')}
          >
            <div className="flex items-center gap-5 sm:gap-7">
              <TabletFace
                palette={palette(match)}
                size={150}
                edge={6}
                ring="rgba(255,255,255,0.8)"
                drop="0 34px 40px rgba(10,5,30,0.4)"
                className="big-mini hidden gap-3 sm:flex"
              >
                <span className="imprint text-[12px] tracking-[3px]">LULL</span>
                <span className="score h-[3px] w-[98px]" />
                <span className="imprint text-[12px] tracking-[3px]">
                  {match.name.toUpperCase()}
                </span>
              </TabletFace>
              <TabletFace
                palette={palette(match)}
                size={84}
                edge={4}
                ring="rgba(255,255,255,0.8)"
                drop="0 20px 24px rgba(10,5,30,0.4)"
                className="big-mini sm:hidden"
              >
                <span className="score h-[2px] w-[54px]" />
              </TabletFace>
              <div className="flex flex-col gap-1.5">
                <span className="font-display text-[14px] font-bold tracking-[0.5px] opacity-90">
                  Dein Match
                </span>
                <h3 className="m-0 font-serif text-[48px] leading-[0.95] font-normal sm:text-[64px] xl:text-[72px]">
                  Lull {match.name}
                </h3>
              </div>
            </div>
            <p className="m-0 text-[17px] leading-[1.55] sm:text-[18px]">{match.finder.pitch}</p>
            <ul className="flex flex-wrap gap-2" aria-label="Ansatzpunkte">
              {match.finder.targets.map((target, k) => (
                <li
                  key={target}
                  className="inline-flex h-[34px] items-center gap-2 rounded-[17px] border border-white/30 bg-white/14 px-3.5 font-display text-[13px] font-bold"
                >
                  <span
                    aria-hidden="true"
                    className="pulse-dot size-[7px] rounded-full bg-white"
                    style={{ animationDelay: `${(k * 0.4).toFixed(1)}s` }}
                  />
                  {target}
                </li>
              ))}
            </ul>
            <dl className="mt-1.5 grid grid-cols-2 gap-4 border-t border-white/25 pt-[18px]">
              <div className="flex flex-col gap-1">
                <dt className="text-[13px] opacity-80">Einnahme</dt>
                <dd className="m-0 text-[16px] font-semibold">{match.finder.when}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[13px] opacity-80">Blister mit 14 Stück</dt>
                <dd className="m-0 font-display text-[20px] font-extrabold">{match.price_eur} €</dd>
              </div>
            </dl>
            <Link
              href={productPath(match)}
              className="btn btn-main mt-1 h-[54px] self-start px-[30px] text-[16px] font-bold"
              style={{ color: match.colors.button_ink }}
            >
              Zu Lull {match.name}
            </Link>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
