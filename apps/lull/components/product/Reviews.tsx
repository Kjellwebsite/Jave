import { Stars } from '@/components/TabletFace';
import { mix, withAlpha } from '@/lib/color';
import type { Product } from '@/lib/products';
import { initials, productRating, starPercent } from '@/lib/ratings';

/**
 * Rating summary and three review cards. PLACEHOLDER content from the prototype: only rendered
 * when `placeholdersEnabled()` (never on the production deployment), see lib/launch.ts.
 */
export function Reviews({ product, textClass }: { product: Product; textClass: string }) {
  const rating = productRating(product);
  const { distribution_5_to_1_percent: distribution, reviews } = product.rating_PLACEHOLDER;
  const { ink, tablet_mid: mid, tablet_bottom: bottom } = product.colors;
  const line = withAlpha(ink, 0.18);

  return (
    <section
      id="bewertungen"
      aria-labelledby="bewertungen-title"
      className="ink-fade grid gap-10 xl:grid-cols-[330px_minmax(0,1fr)] xl:gap-[60px]"
      style={{ color: ink }}
    >
      <div className={`${textClass} flex max-w-[560px] flex-col gap-3.5`}>
        <h2
          id="bewertungen-title"
          className="m-0 font-serif text-[38px] leading-[1.05] font-normal sm:text-[44px]"
        >
          Das sagen Nutzer von {product.name}
        </h2>
        <div className="mt-1.5 flex items-end gap-3.5">
          <span className="font-display text-[76px] leading-[0.9] font-extrabold tracking-[-2px]">
            {rating.average}
          </span>
          <span className="flex flex-col gap-1.5 pb-1.5">
            <Stars
              percent={rating.starPercent}
              size={20}
              base={{ opacity: 0.25 }}
              fill="var(--color-star-deep)"
            />
            <span className="text-[14px] opacity-80">aus {rating.count} Bewertungen</span>
          </span>
        </div>
        <ul className="mt-2 flex flex-col gap-2" aria-label="Verteilung der Bewertungen">
          {distribution.map((percent, k) => (
            <li key={k} className="flex items-center gap-3 text-[14px] tabular-nums">
              <span className="w-[26px]" aria-hidden="true">
                {5 - k} ★
              </span>
              <span className="sr-only">{5 - k} Sterne:</span>
              <span className="h-2 grow overflow-hidden rounded" style={{ background: line }}>
                <span
                  className="dist-fill block"
                  style={{ width: `${percent}%`, background: mid }}
                />
              </span>
              <span className="w-9 text-right opacity-80">{percent} %</span>
            </li>
          ))}
        </ul>
      </div>

      <ul className="grid items-start gap-5 md:grid-cols-3">
        {reviews.map((review, k) => (
          <li
            key={`${product.slug}-${k}`}
            className={`review ${textClass} flex flex-col gap-3.5 rounded-[26px] p-[26px]`}
            style={{ animationDelay: `${(0.1 + k * 0.1).toFixed(2)}s` }}
          >
            <div className="flex items-center justify-between gap-2.5">
              <Stars
                percent={starPercent(review.r)}
                size={16}
                base={{ opacity: 0.2 }}
                fill="var(--color-star-deep)"
              />
              <span className="sr-only">{review.r} von 5 Sternen</span>
              <span className="text-[12px] font-semibold opacity-70">{review.since}</span>
            </div>
            <h3 className="m-0 font-display text-[17px] leading-[1.3] font-bold">{review.title}</h3>
            <p className="m-0 text-[15px] leading-[1.6]">{review.text}</p>
            <div
              className="mt-1 flex items-center gap-2.5 border-t pt-3.5"
              style={{ borderColor: line }}
            >
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full font-display text-[13px] font-bold text-white"
                style={{
                  background: `linear-gradient(135deg, ${[mid, bottom, mix(mid, '#1c1548', 0.4)][k % 3]}, ${mix(bottom, '#1c1548', 0.3)})`,
                }}
              >
                {initials(review.name)}
              </span>
              <span className="flex flex-col gap-px">
                <span className="text-[14px] font-semibold">{review.name}</span>
                <span className="inline-flex items-center gap-[5px] text-[12px] opacity-75">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <circle cx="6" cy="6" r="6" fill="currentColor" fillOpacity="0.25" />
                    <path
                      d="M3.3 6.2 L5.2 8 L8.8 4.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Verifizierter Kauf
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
