import Link from 'next/link';
import { Reveal } from '@/components/Reveal';
import { Stars, TabletFace } from '@/components/TabletFace';
import { palette, PRODUCTS, productPath } from '@/lib/products';
import { productRating } from '@/lib/ratings';

/** Five product cards. Hover (or keyboard focus) swaps the tablet for the ingredient list. */
export function Sortiment({ showRatings }: { showRatings: boolean }) {
  return (
    <Reveal
      as="section"
      id="sortiment"
      aria-labelledby="sortiment-title"
      className="on-light relative mt-20 text-ink lg:mt-[90px]"
    >
      <div className="wrap flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-10">
        <h2
          id="sortiment-title"
          className="m-0 font-serif text-[52px] leading-none font-normal sm:text-[72px]"
        >
          Das Sortiment
        </h2>
        <p className="m-0 max-w-[400px] text-[17px] leading-[1.55] text-ink-soft md:mb-2">
          Fünf Zustände, fünf Tabletten.{' '}
          <span className="hover-hint">Fahr über eine Karte, um reinzuschauen.</span>
        </p>
      </div>

      {/* Below 1280 px the cards scroll sideways; the list keeps the page gutter as padding. */}
      <ul className="card-rail mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-(--gutter) px-(--gutter) pt-2 pb-10 lg:mt-12 xl:pt-0 xl:mx-auto xl:grid xl:w-[min(1200px,100%-2*var(--gutter))] xl:grid-cols-5 xl:gap-5 xl:overflow-visible xl:px-0 xl:pb-0">
        {PRODUCTS.map((product) => {
          const [light, mid, dark] = product.colors.card_stops;
          const rating = showRatings ? productRating(product) : null;
          return (
            <li key={product.slug} className="w-[248px] shrink-0 snap-start xl:w-auto">
              <Link
                href={productPath(product)}
                aria-label={`Lull ${product.name}, ${product.category}, ${product.price_eur} €`}
                className="card relative box-border flex h-[470px] flex-col overflow-hidden rounded-[28px] px-5 pt-[26px] pb-6 text-white no-underline"
                style={{
                  background: `linear-gradient(180deg, ${light} 0%, ${mid} 48%, ${dark} 100%)`,
                  // Keyboard focus ring on the colored card.
                  ['--focus' as string]: product.colors.ink,
                }}
              >
                <div
                  className="card-top flex h-[170px] items-center justify-center"
                  aria-hidden="true"
                >
                  <TabletFace
                    palette={palette(product)}
                    size={92}
                    edge={4}
                    drop="0 18px 22px rgba(10,5,40,0.35)"
                    style={{ transform: 'rotate(-12deg)' }}
                  >
                    <span className="btab-score w-[60px]! h-[3px]!" />
                  </TabletFace>
                </div>
                <div className="card-ing absolute top-6 left-5 flex w-[calc(100%-40px)] flex-col gap-[9px]">
                  <span className="font-display text-[12px] font-bold tracking-[0.5px] opacity-85">
                    Pro Tablette
                  </span>
                  {product.ingredients.map((ingredient) => (
                    <span
                      key={ingredient.name}
                      className="flex justify-between gap-2 border-b border-white/25 pb-2 text-[13px] leading-[1.3]"
                    >
                      <span>{ingredient.name}</span>
                      <span className="font-display font-bold whitespace-nowrap">
                        {ingredient.dose}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex flex-col gap-2">
                  <span className="font-display text-[13px] font-bold tracking-[0.5px] opacity-85">
                    {product.category}
                  </span>
                  <span className="font-serif text-[44px] leading-none">{product.name}</span>
                  {rating && (
                    <span className="flex items-center gap-[7px] text-[13px]">
                      <Stars
                        percent={rating.starPercent}
                        size={13}
                        base={{ color: 'rgba(255,255,255,0.35)' }}
                        fill="var(--color-star)"
                      />
                      <b className="font-display">{rating.average}</b>
                      <span className="opacity-80">({rating.count})</span>
                    </span>
                  )}
                  <span className="min-h-[68px] text-[15px] leading-[1.5] opacity-90">
                    {product.card_blurb}
                  </span>
                  {/* Syne is wide: the price shrinks a little in the five-column grid. */}
                  <span className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-display text-[20px] font-extrabold tracking-[-0.02em] whitespace-nowrap xl:text-[18px]">
                      {product.price_eur} €
                    </span>
                    <span className="card-go ml-auto text-[14px] font-semibold">Ansehen</span>
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Reveal>
  );
}
