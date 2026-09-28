import type { CSSProperties } from 'react';
import type { Flavor } from '@/lib/products';
import { seededRandom } from '@/lib/random';

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Three cumulus silhouettes in a 240 x 130 box: bumps on top of a flat base. Each bump also gets a
 * soft highlight dome, which is what makes the cloud read as round instead of cut out.
 */
const SHAPES: { bumps: Circle[]; base: { x: number; y: number; width: number; height: number } }[] =
  [
    {
      bumps: [
        { cx: 62, cy: 86, r: 36 },
        { cx: 104, cy: 60, r: 46 },
        { cx: 152, cy: 56, r: 40 },
        { cx: 188, cy: 80, r: 32 },
        { cx: 128, cy: 86, r: 34 },
      ],
      base: { x: 30, y: 80, width: 186, height: 42 },
    },
    {
      bumps: [
        { cx: 52, cy: 90, r: 28 },
        { cx: 88, cy: 70, r: 38 },
        { cx: 132, cy: 56, r: 44 },
        { cx: 176, cy: 72, r: 34 },
        { cx: 206, cy: 92, r: 24 },
      ],
      base: { x: 26, y: 86, width: 200, height: 34 },
    },
    {
      bumps: [
        { cx: 66, cy: 88, r: 32 },
        { cx: 110, cy: 54, r: 48 },
        { cx: 160, cy: 70, r: 38 },
        { cx: 196, cy: 94, r: 24 },
      ],
      base: { x: 36, y: 86, width: 182, height: 36 },
    },
  ];

/**
 * Cloud puffs. `x` is the left edge in percent of the band. Far clouds (depth 0) hang from the
 * top, near ones (depth 1) stand on the bottom, so the copy in the middle stays clear at every
 * width: `top`/`bottom` and the width `w` are px at 1440, scaled with the band (`--pu`).
 * `wide` puffs only show on wider screens.
 */
const PUFFS: {
  shape: number;
  x: number;
  top?: number;
  bottom?: number;
  w: number;
  depth: 0 | 1;
  flip?: boolean;
  wide?: boolean;
}[] = [
  { shape: 0, x: 2, top: 22, w: 220, depth: 0 },
  { shape: 2, x: 25, top: 0, w: 170, depth: 0, flip: true, wide: true },
  { shape: 1, x: 67, top: 12, w: 210, depth: 0 },
  { shape: 2, x: 87, top: 150, w: 170, depth: 0, wide: true },
  { shape: 1, x: 9, top: 196, w: 150, depth: 0, flip: true, wide: true },
  { shape: 1, x: -6, bottom: 44, w: 400, depth: 1 },
  { shape: 2, x: 27, bottom: 60, w: 300, depth: 1, flip: true, wide: true },
  { shape: 0, x: 57, bottom: 50, w: 340, depth: 1 },
  { shape: 2, x: 83, bottom: 116, w: 320, depth: 1, wide: true },
];

const SPARKS = (() => {
  const random = seededRandom(7);
  return Array.from({ length: 26 }, () => ({
    x: random() * 100,
    y: 35 + random() * 60,
    size: 2 + random() * 4,
    delay: -random() * 9,
    duration: 6 + random() * 6,
  }));
})();

/**
 * The taste of the tablet as a band of drifting clouds in its colors (e.g. "Raspberry Clouds").
 * Decorative clouds around readable copy.
 */
export function FlavorClouds({
  flavor,
  ink,
  textClass,
}: {
  flavor: Flavor;
  /** Text color of the product page. */
  ink: string;
  textClass: string;
}) {
  const [deep, mid, light] = flavor.colors;
  const vars: CssVars = { color: ink, '--fl-deep': deep, '--fl-mid': mid, '--fl-light': light };

  return (
    <section className="flavor-band" style={vars} aria-labelledby="flavor-title">
      <svg className="absolute size-0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="flavor-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: '#fff6fa' }} />
            <stop offset="0.45" style={{ stopColor: 'var(--fl-light)' }} />
            <stop offset="0.82" style={{ stopColor: 'var(--fl-mid)' }} />
            <stop offset="1" style={{ stopColor: 'var(--fl-deep)' }} />
          </linearGradient>
          <radialGradient id="flavor-dome" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.34">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id="flavor-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1" />
          </filter>
          <filter id="flavor-dome-blur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id="flavor-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          {SHAPES.map((shape, i) => (
            <g key={i} id={`flavor-cloud-${i}`}>
              {shape.bumps.map((c) => (
                <circle key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} />
              ))}
              <rect {...shape.base} rx={shape.base.height / 2} />
            </g>
          ))}
          {SHAPES.map((shape, i) => (
            <g key={i} id={`flavor-domes-${i}`}>
              {shape.bumps.map((c) => (
                <circle key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r * 0.9} />
              ))}
            </g>
          ))}
        </defs>
      </svg>

      <div className="flavor-sky" aria-hidden="true">
        <div className="flavor-haze" />
        {PUFFS.map((puff, i) => (
          <div
            key={i}
            className={puff.wide ? 'puff puff-wide' : 'puff'}
            data-depth={puff.depth}
            style={
              {
                '--x': `${puff.x}%`,
                '--w': puff.w,
                top: puff.top === undefined ? undefined : `calc(${puff.top} * var(--pu))`,
                bottom: puff.bottom === undefined ? undefined : `calc(${puff.bottom} * var(--pu))`,
                animationDuration: `${puff.depth ? 34 + i : 46 + i * 2}s`,
                animationDelay: `${-i * 3.7}s`,
              } as CssVars
            }
          >
            <svg
              viewBox="0 0 240 130"
              className="puff-svg"
              style={puff.flip ? { transform: 'scaleX(-1)' } : undefined}
            >
              <use
                href={`#flavor-cloud-${puff.shape}`}
                fill="var(--fl-deep)"
                opacity="0.35"
                filter="url(#flavor-shadow)"
                transform="translate(0 12)"
              />
              <use
                href={`#flavor-cloud-${puff.shape}`}
                fill="url(#flavor-body)"
                filter="url(#flavor-soft)"
              />
              <use
                href={`#flavor-domes-${puff.shape}`}
                fill="url(#flavor-dome)"
                filter="url(#flavor-dome-blur)"
              />
            </svg>
          </div>
        ))}
        {SPARKS.map((spark, i) => (
          <span
            key={`s${i}`}
            className="flavor-spark"
            style={{
              left: `${spark.x.toFixed(2)}%`,
              top: `${spark.y.toFixed(2)}%`,
              width: spark.size,
              height: spark.size,
              animationDelay: `${spark.delay.toFixed(2)}s`,
              animationDuration: `${spark.duration.toFixed(2)}s`,
            }}
          />
        ))}
      </div>

      <div className={`${textClass} flavor-copy`}>
        <span className="font-display text-[13px] font-bold tracking-[0.5px] opacity-80">
          Geschmack
        </span>
        <h2 id="flavor-title" className="flavor-title m-0 font-serif font-normal">
          {flavor.name}
        </h2>
        <p className="m-0 max-w-[420px] text-[17px] leading-[1.55]">{flavor.note}</p>
      </div>
    </section>
  );
}
