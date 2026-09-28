import type { CSSProperties } from 'react';
import type { Flavor } from '@/lib/products';
import { seededRandom } from '@/lib/random';

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Blueberries around the moon: `x`/`y` in percent of the band on wide screens, `mx`/`my` on
 * phones, size in px at 1440 (scaled with `--pu`), depth 0 far and soft, 1 near and crisp.
 */
const BERRIES = [
  { x: 56, y: 20, mx: 14, my: 8, s: 74, depth: 1, turn: -18 },
  { x: 86, y: 15, mx: 86, my: 6, s: 44, depth: 0, turn: 24 },
  { x: 61, y: 70, mx: 22, my: 36, s: 104, depth: 1, turn: 12 },
  { x: 90, y: 62, mx: 84, my: 32, s: 62, depth: 1, turn: -30 },
  { x: 77, y: 88, mx: 64, my: 42, s: 40, depth: 0, turn: 40 },
  { x: 97, y: 36, mx: 96, my: 20, s: 30, depth: 0, turn: -8 },
  { x: 51, y: 46, mx: 6, my: 24, s: 28, depth: 0, turn: 16 },
];

const CRATERS = [
  { x: 20, y: 56, s: 19 },
  { x: 52, y: 24, s: 13 },
  { x: 60, y: 60, s: 23 },
  { x: 36, y: 78, s: 9 },
  { x: 76, y: 40, s: 8 },
  { x: 29, y: 32, s: 7 },
];

const STARS = (() => {
  const random = seededRandom(11);
  return Array.from({ length: 70 }, () => ({
    x: random() * 100,
    y: random() * 100,
    size: 1 + random() * 1.8,
    delay: -random() * 6,
    duration: 2.5 + random() * 3.5,
  }));
})();

const SPARKLES = [
  { x: 12, y: 18, s: 14 },
  { x: 40, y: 12, s: 10 },
  { x: 70, y: 8, s: 12 },
  { x: 94, y: 82, s: 16 },
  { x: 8, y: 78, s: 10 },
];

/** The five-pointed crown (calyx) on top of a blueberry. */
const CROWN = (() => {
  const points: string[] = [];
  for (let k = 0; k < 10; k++) {
    const angle = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 11 : 4.6;
    points.push(`${(Math.cos(angle) * r).toFixed(2)} ${(Math.sin(angle) * r).toFixed(2)}`);
  }
  return `M${points.join(' L')} Z`;
})();

/**
 * The taste of the tablet as a night sky: a glowing moon, blueberries drifting around it,
 * twinkling stars. Decorative; the copy on the left names the flavor.
 */
export function FlavorMoon({ flavor, textClass }: { flavor: Flavor; textClass: string }) {
  const [deep, mid, light] = flavor.colors;
  const vars: CssVars = { '--fl-deep': deep, '--fl-mid': mid, '--fl-light': light };

  return (
    <section className="moon-band" style={vars} aria-labelledby="flavor-title">
      <svg className="absolute size-0" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="berry-body" cx="0.38" cy="0.34" r="0.75">
            <stop offset="0" stopColor="#9aa5ff" />
            <stop offset="0.3" style={{ stopColor: 'var(--fl-deep)' }} />
            <stop offset="0.72" stopColor="#242a8f" />
            <stop offset="1" stopColor="#12155a" />
          </radialGradient>
          <radialGradient id="berry-bloom" cx="0.5" cy="0.46" r="0.52">
            <stop offset="0.6" stopColor="#d7ddff" stopOpacity="0" />
            <stop offset="1" stopColor="#d7ddff" stopOpacity="0.34" />
          </radialGradient>
          <filter id="berry-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <g id="berry">
            <circle cx="50" cy="52" r="44" fill="url(#berry-body)" />
            <circle cx="50" cy="52" r="44" fill="url(#berry-bloom)" />
            <ellipse
              cx="35"
              cy="33"
              rx="13"
              ry="7"
              fill="#ffffff"
              opacity="0.5"
              filter="url(#berry-soft)"
            />
            <g transform="translate(58 19) scale(1 0.62)">
              <path
                d={CROWN}
                fill="#171a4f"
                stroke="#aab4ff"
                strokeOpacity="0.45"
                strokeWidth="1.2"
              />
              <circle r="3.4" fill="#0b0d33" />
            </g>
          </g>
        </defs>
      </svg>

      <div className="moon-sky" aria-hidden="true">
        {STARS.map((star, i) => (
          <span
            key={i}
            className="moon-star"
            style={{
              left: `${star.x.toFixed(2)}%`,
              top: `${star.y.toFixed(2)}%`,
              width: star.size,
              height: star.size,
              animationDelay: `${star.delay.toFixed(2)}s`,
              animationDuration: `${star.duration.toFixed(2)}s`,
            }}
          />
        ))}
        {SPARKLES.map((sparkle, i) => (
          <span
            key={`p${i}`}
            className="moon-sparkle"
            style={{
              left: `${sparkle.x}%`,
              top: `${sparkle.y}%`,
              width: sparkle.s,
              height: sparkle.s,
              animationDelay: `${-i * 1.3}s`,
            }}
          />
        ))}
        <span className="moon-shoot" />

        <div className="moon-orb">
          <div className="moon-halo" />
          <div className="moon-disc">
            {CRATERS.map((crater, i) => (
              <span
                key={i}
                className="moon-crater"
                style={{
                  left: `${crater.x}%`,
                  top: `${crater.y}%`,
                  width: `${crater.s}%`,
                  height: `${crater.s}%`,
                }}
              />
            ))}
          </div>
        </div>

        {BERRIES.map((berry, i) => (
          <div
            key={i}
            className="berry"
            data-depth={berry.depth}
            style={
              {
                '--x': `${berry.x}%`,
                '--y': `${berry.y}%`,
                '--mx': `${berry.mx}%`,
                '--my': `${berry.my}%`,
                '--s': berry.s,
                '--turn': `${berry.turn}deg`,
                animationDelay: `${-i * 1.7}s`,
                animationDuration: `${8 + (i % 3) * 2.5}s`,
              } as CssVars
            }
          >
            <svg viewBox="0 0 100 100">
              <use href="#berry" />
            </svg>
          </div>
        ))}
      </div>

      <div className={`${textClass} moon-copy`}>
        <span className="font-display text-[13px] font-bold tracking-[0.5px] opacity-80">
          Geschmack
        </span>
        <h2 id="flavor-title" className="moon-title m-0 font-serif font-normal">
          {flavor.name}
        </h2>
        <p className="m-0 max-w-[420px] text-[17px] leading-[1.55] opacity-90">{flavor.note}</p>
      </div>
    </section>
  );
}
