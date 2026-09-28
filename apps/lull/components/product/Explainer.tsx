import type { Explainer as ExplainerCopy, Product } from '@/lib/products';
import { ArousalGraphic } from './ArousalGraphic';

/** "Weniger Überreizung": what the formula targets, with the interactive schematic. */
export function Explainer({
  product,
  copy,
  textClass,
}: {
  product: Product;
  copy: ExplainerCopy;
  textClass: string;
}) {
  const dots = [product.colors.tablet_mid, product.colors.tablet_bottom, '#8f7ae0', '#4aa8ff'];
  return (
    <section
      id="wirkung"
      aria-labelledby="wirkung-title"
      className="grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-[70px] lg:py-[70px]"
    >
      <div className={`${textClass} flex flex-col gap-[18px]`}>
        <span className="font-display text-[13px] font-bold tracking-[0.5px] opacity-80">
          {copy.eyebrow}
        </span>
        <h2
          id="wirkung-title"
          className="m-0 font-serif text-[42px] leading-[1.02] font-normal sm:text-[52px]"
        >
          {copy.title}
        </h2>
        <p className="m-0 text-[17px] leading-[1.6] sm:text-[18px]">{copy.lead}</p>
        <ul className="mt-2 flex flex-col gap-4">
          {product.ingredients.map((ingredient, k) => (
            <li key={ingredient.name} className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="mt-1.5 size-2.5 shrink-0 rounded-full"
                style={{
                  background: dots[k % dots.length],
                  boxShadow: `0 0 10px ${dots[k % dots.length]}`,
                }}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-display text-[15px] font-bold">
                  {ingredient.name}{' '}
                  <span className="font-semibold opacity-60">{ingredient.dose}</span>
                </span>
                <span className="text-[15px] leading-[1.5] opacity-85">{ingredient.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={textClass} style={{ animationDelay: '0.15s' }}>
        <ArousalGraphic busyLabel={copy.busy} calmLabel={copy.calm} />
      </div>
    </section>
  );
}
