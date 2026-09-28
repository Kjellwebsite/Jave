import { RollingDigit } from '@/components/RollingDigits';

/**
 * The hero price. Digits roll up on load; when the product changes, the same digit columns
 * slide to the new values (a CSS transition on transform), so the columns must persist.
 */
export function RollingPrice({ price, oldPrice }: { price: string; oldPrice: string }) {
  return (
    <>
      <span className="sr-only">
        {price} €, vorher {oldPrice} €
      </span>
      <div
        className="price flex items-end font-display font-extrabold tabular-nums"
        aria-hidden="true"
      >
        {price.split('').map((char, i) =>
          /\d/.test(char) ? (
            <RollingDigit
              key={i}
              digit={Number(char)}
              style={{
                animationDelay: `${(0.2 + i * 0.14).toFixed(2)}s`,
                transitionDelay: `${(i * 0.08).toFixed(2)}s`,
              }}
            />
          ) : (
            <span key={i} className="inline-block h-(--dh) leading-(--dh)">
              {char}
            </span>
          ),
        )}
        <span className="euro ml-2 inline-block h-[1.7em] text-[0.625em] leading-[1.7em] font-bold">
          €
        </span>
      </div>
    </>
  );
}
