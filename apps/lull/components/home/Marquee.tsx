import { allIngredients } from '@/lib/products';

/** The slanted glass band with every active ingredient and its dose, scrolling endlessly. */
export function Marquee() {
  const items = allIngredients();
  const row = (hidden: boolean) => (
    <ul className="flex" aria-hidden={hidden || undefined}>
      {items.map(({ ingredient, product }, i) => (
        <li
          key={`${product.slug}-${i}`}
          className="flex items-center gap-3 px-[26px] font-display text-[15px] font-bold whitespace-nowrap text-white sm:text-[18px]"
        >
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{
              background: product.colors.tablet_mid,
              boxShadow: `0 0 12px ${product.colors.tablet_mid}`,
            }}
          />
          <span>{ingredient.name}</span>
          <span className="font-semibold opacity-60">{ingredient.dose}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="marquee-band" role="region" aria-label="Alle Wirkstoffe mit Dosis">
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
