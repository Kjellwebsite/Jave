import { GermanFlag } from '@/components/GermanFlag';
import { Reveal } from '@/components/Reveal';
import { SHIPPING } from '@/lib/content';
import { PRODUCTS } from '@/lib/products';

/** y, width, delay, duration, opacity of the light streaks behind the card (prototype values). */
const STREAKS = [
  [70, 180, 0, 2.6, 0.5],
  [150, 260, -1.2, 3.2, 0.35],
  [230, 140, -0.5, 2.2, 0.6],
  [300, 220, -2, 2.9, 0.4],
  [360, 120, -0.8, 2.4, 0.5],
  [120, 90, -1.7, 2, 0.3],
  [460, 200, -2.4, 3.4, 0.3],
] as const;

/** Seven tablets in the envelope's blister, cycling through the product colors. */
const DOTS = [0, 1, 2, 3, 4, 0, 1].map((i) => PRODUCTS[i % PRODUCTS.length]!);

/** A blister drops into an envelope, the flap closes, a sticker seals it and it flies off. */
function Envelope() {
  return (
    <div className="env-scale" aria-hidden="true">
      <div className="env-stage">
        <div className="speed" style={{ left: -120, top: 60, width: 110 }} />
        <div
          className="speed"
          style={{ left: -90, top: 100, width: 80, animationDelay: '0.05s' }}
        />
        <div
          className="speed"
          style={{ left: -140, top: 140, width: 130, animationDelay: '0.1s' }}
        />
        <div className="env-fly">
          <div className="env-shadow" />
          <div className="env-back" />
          <div className="env-blister">
            {DOTS.map((product, i) => (
              <span
                key={i}
                className="env-dot"
                style={{
                  boxShadow: `0 2px 0 ${product.colors.tablet_mid}, 0 4px 0 ${product.colors.tablet_bottom}`,
                }}
              />
            ))}
          </div>
          <div className="env-front" />
          <div className="env-bottom" />
          <div className="env-flap" />
          <div className="env-sticker">L</div>
        </div>
      </div>
    </div>
  );
}

export function Shipping() {
  return (
    <Reveal
      as="section"
      id="versand"
      aria-labelledby="versand-title"
      className="wrap ship mt-16 text-white lg:min-h-[540px]"
    >
      <div aria-hidden="true" className="grain grain-under" />
      {STREAKS.map(([y, width, delay, duration, opacity], i) => (
        <div
          key={i}
          aria-hidden="true"
          className="streak"
          style={{
            top: y,
            width,
            opacity,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
          }}
        />
      ))}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 px-5 pt-9 pb-10 sm:px-10 sm:pt-12 lg:grid-cols-[minmax(0,560px)_440px] lg:justify-between lg:gap-x-10 lg:px-16 lg:pt-[60px] lg:pb-[64px]">
        <div className="flex flex-col gap-5">
          <span className="inline-flex h-[34px] items-center gap-2.5 self-start rounded-[17px] border border-white/25 bg-white/12 px-3.5 text-[14px] font-semibold">
            <GermanFlag width={18} height={12} />
            {SHIPPING.badge}
          </span>
          <h2
            id="versand-title"
            className="m-0 font-serif text-[46px] leading-none font-normal sm:text-[64px]"
          >
            {SHIPPING.title[0]}
            <br />
            {SHIPPING.title[1]}
          </h2>
          <p className="m-0 text-[17px] leading-[1.6] text-haze sm:text-[18px]">{SHIPPING.lead}</p>
        </div>

        <div className="flex justify-center lg:justify-start lg:pt-[90px] lg:pl-[70px]">
          <Envelope />
        </div>

        <div className="tl lg:col-span-2 lg:mt-[-12px]">
          <div aria-hidden="true" className="tl-track" />
          <div aria-hidden="true" className="tl-fill" />
          <ol className="tl-steps" aria-label="So läuft der Versand">
            {SHIPPING.steps.map((step, i) => (
              <li key={step.title} className="tl-step">
                <span aria-hidden="true" className="tl-dot">
                  <span className="tl-dot-in" style={{ animationName: `step${i}` }} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-display text-[16px] font-bold">{step.title}</span>
                  <span className="text-[14px] text-haze-deep">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Reveal>
  );
}
