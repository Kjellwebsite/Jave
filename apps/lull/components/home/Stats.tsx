import { Reveal } from '@/components/Reveal';
import { RollingDigit } from '@/components/RollingDigits';
import { STAT_NOTES, TABLETS_PER_BLISTER } from '@/lib/content';
import { distinctIngredientCount, PRODUCTS } from '@/lib/products';

/** Four figures whose digits roll up when the row scrolls into view. */
export function Stats() {
  const stats = [
    { value: PRODUCTS.length, label: 'Formeln', note: STAT_NOTES.formulas },
    { value: distinctIngredientCount(), label: 'Wirkstoffe', note: STAT_NOTES.ingredients },
    { value: 3, label: 'Schichten', note: STAT_NOTES.layers },
    { value: TABLETS_PER_BLISTER, label: 'Tabletten', note: STAT_NOTES.tablets },
  ];

  return (
    <Reveal
      as="section"
      aria-label="Lull in Zahlen"
      className="wrap on-light relative mt-16 text-ink lg:mt-[78px]"
    >
      <ul className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4 lg:gap-10">
        {stats.map((stat, k) => (
          <li key={stat.label} className="flex flex-col gap-2.5">
            <div
              className="stat-number flex font-display font-extrabold tabular-nums"
              aria-hidden="true"
            >
              {String(stat.value)
                .split('')
                .map((char, j) => (
                  <RollingDigit
                    key={j}
                    digit={Number(char)}
                    style={{ animationDelay: `${(k * 0.15 + j * 0.12).toFixed(2)}s` }}
                  />
                ))}
            </div>
            <div
              className="stat-bar w-16"
              style={{ animationDelay: `${(0.3 + k * 0.15).toFixed(2)}s` }}
            />
            <h3 className="m-0 font-serif text-[26px] leading-[1.1] font-normal sm:text-[30px]">
              <span className="sr-only">{stat.value} </span>
              {stat.label}
            </h3>
            <p className="m-0 text-[15px] leading-[1.5] text-ink-mute">{stat.note}</p>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
