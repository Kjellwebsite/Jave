import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Ambient, type CloudSpec } from '@/components/Ambient';
import { GermanFlag } from '@/components/GermanFlag';
import { SiteHeader, type NavItem } from '@/components/SiteHeader';
import { Tablet } from '@/components/Tablet';
import { Stars } from '@/components/TabletFace';
import { HERO } from '@/lib/content';
import { DEFAULT_PRODUCT, getProduct, palette, productPath } from '@/lib/products';
import { motes } from '@/lib/random';
import type { RatingSummary } from '@/lib/ratings';
import { HeroPointer } from './HeroPointer';

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

const NAV: NavItem[] = [
  { href: '#finder', label: 'Tablette finden' },
  { href: '#sortiment', label: 'Sortiment' },
  { href: '#zertifikat', label: 'Qualität' },
  { href: '#versand', label: 'Versand' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * The arc of five tablets. Desktop values are prototype pixels at 1440 px (x relative to the
 * center, y from the top); `m` places the three tablets that remain on phones.
 */
const ARC = [
  { slug: 'bloom', dx: -530, dy: 360, ds: 140, enter: 0.55, depth: 26 },
  { slug: 'drift', dx: -280, dy: 300, ds: 175, enter: 0.35, depth: 16, m: [-118, 205, 92] },
  { slug: 'calm', dx: 0, dy: 290, ds: 240, enter: 0.15, depth: 9, m: [0, 175, 150] },
  { slug: 'spark', dx: 280, dy: 300, ds: 175, enter: 0.45, depth: 16, m: [118, 205, 92] },
  { slug: 'tide', dx: 530, dy: 360, ds: 140, enter: 0.65, depth: 26 },
] as const;

const CLOUDS: CloudSpec[] = [
  {
    left: '13.9%',
    top: 'calc(var(--u) * 120)',
    width: 'calc(var(--u) * 620)',
    height: 'calc(var(--u) * 420)',
    color: 'rgba(255,255,255,0.22)',
    duration: 28,
  },
  {
    left: '43.1%',
    top: 'calc(var(--u) * 60)',
    width: 'calc(var(--u) * 640)',
    height: 'calc(var(--u) * 460)',
    color: 'rgba(236,214,255,0.26)',
    duration: 32,
    delay: -9,
  },
  {
    left: '2.8%',
    top: 'calc(var(--u) * 300)',
    width: 'calc(var(--u) * 520)',
    height: 'calc(var(--u) * 360)',
    color: 'rgba(150,200,255,0.2)',
    duration: 24,
    delay: -5,
  },
  {
    left: '62.5%',
    top: 'calc(var(--u) * 300)',
    width: 'calc(var(--u) * 520)',
    height: 'calc(var(--u) * 380)',
    color: 'rgba(255,190,225,0.2)',
    duration: 26,
    delay: -14,
  },
];

const MOTES = motes(23, 60, 1440, 700, 1440, 720);

export function Hero({ rating }: { rating: RatingSummary | null }) {
  return (
    <HeroPointer className="home-hero" aria-labelledby="hero-title">
      <div className="bg-under home-hero-bg" />
      <div className="grain grain-under" />
      <div className="spot" aria-hidden="true" />

      <div className="absolute inset-x-0 top-4 z-30 lg:top-10">
        <div className="wrap">
          <SiteHeader
            links={NAV}
            cta={
              <Link
                href={productPath(DEFAULT_PRODUCT)}
                className="btn btn-ghost h-11 px-[22px] text-base font-medium"
              >
                Shop
              </Link>
            }
          />
        </div>
      </div>

      <div className="hero-stage" aria-hidden="true">
        <div className="par hero-ambient">
          <Ambient clouds={CLOUDS} motes={MOTES} className="absolute inset-0" />
        </div>
        <div className="par hero-halo">
          <div className="halo" />
        </div>
        {ARC.map((spot, k) => {
          const product = getProduct(spot.slug);
          if (!product) return null;
          const mobile = 'm' in spot ? spot.m : undefined;
          const vars: CssVars = {
            '--dx': spot.dx,
            '--dy': spot.dy,
            '--ds': spot.ds,
            '--dp': spot.depth,
          };
          if (mobile) {
            vars['--mx'] = mobile[0];
            vars['--my'] = mobile[1];
            vars['--ms'] = mobile[2];
          }
          return (
            <div
              key={spot.slug}
              className="hero-tab"
              style={vars}
              data-outer={mobile ? undefined : ''}
            >
              <div className="par">
                <div className="tab-in" style={{ animationDelay: `${spot.enter}s` }}>
                  <div className="pill-shadow" style={{ animationDelay: `${-k * 1.6}s` }} />
                  <div className="pill-float" style={{ animationDelay: `${-k * 1.6}s` }}>
                    <Tablet
                      palette={palette(product)}
                      code={product.name.toUpperCase()}
                      layers={32}
                      lite
                      tiltDelay={Number((-k * 3.3).toFixed(2))}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="wrap relative flex flex-col items-center gap-6 pb-[88px] text-center lg:pb-[46px]">
        <h1
          id="hero-title"
          className="hero-title enter m-0 font-serif font-normal"
          style={{ animationDelay: '0.5s' }}
        >
          {HERO.headline} <em className="hero-accent">{HERO.accent}</em>
        </h1>
        <p
          className="enter m-0 max-w-[640px] text-[17px] leading-[1.55] text-haze-light sm:text-[20px]"
          style={{ animationDelay: '0.65s' }}
        >
          {HERO.lead}
        </p>
        <div
          className="enter mt-1.5 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4"
          style={{ animationDelay: '0.8s' }}
        >
          <Link
            href="#finder"
            className="btn btn-main h-[58px] px-[34px] text-[17px] text-[#2e1a80]"
          >
            Finde deine Tablette
          </Link>
          <Link href="#sortiment" className="btn btn-ghost h-[58px] px-[30px] text-[17px]">
            Sortiment ansehen
          </Link>
        </div>
        <ul
          className="enter mt-0.5 flex flex-wrap items-center justify-center gap-x-[18px] gap-y-2 text-sm text-haze"
          style={{ animationDelay: '1s' }}
        >
          {rating && (
            <>
              <li className="inline-flex items-center gap-2">
                <Stars
                  percent={rating.starPercent}
                  size={14}
                  base={{ color: 'rgba(255,255,255,0.3)' }}
                  fill="var(--color-star)"
                />
                <span>
                  <b className="font-display">{rating.average}</b> aus über {rating.count}{' '}
                  Bewertungen
                </span>
              </li>
              <li aria-hidden="true" className="trust-sep hidden sm:block" />
            </>
          )}
          <li className="inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="8" fill="#ffffff" fillOpacity="0.2" />
              <path
                d="M4.5 8.2 L7 10.5 L11.5 5.5"
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            AM-zertifiziert
          </li>
          <li aria-hidden="true" className="trust-sep hidden sm:block" />
          <li className="inline-flex items-center gap-2">
            <GermanFlag width={16} height={11} />
            Als Brief aus Deutschland
          </li>
        </ul>
      </div>
    </HeroPointer>
  );
}
