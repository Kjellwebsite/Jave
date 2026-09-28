import { SUPPLEMENT_NOTICES } from '@/lib/content';
import type { Product } from '@/lib/products';

function WarningIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0">
      <path d="M10 2.5 L18.5 17.5 H1.5 Z" fill={color} />
      <path d="M10 8 V12" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="1.1" fill="#ffffff" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="10" cy="10" r="9" fill="currentColor" fillOpacity="0.14" />
      <path d="M10 9 V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Recommended intake, product warnings and the mandatory supplement notices. */
export function Notices({ product, textClass }: { product: Product; textClass: string }) {
  const warnings = product.warnings ?? [];
  return (
    <section
      id="hinweise"
      aria-labelledby="hinweise-title"
      className={`${textClass} py-14 lg:py-[60px]`}
    >
      <h2 id="hinweise-title" className="m-0 font-serif text-[40px] leading-[1.1] font-normal">
        Gut zu wissen
      </h2>
      <div className="notice-card mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h3 className="m-0 font-display text-[16px] font-bold">Verzehrempfehlung</h3>
          <p className="m-0 text-[16px] leading-[1.6]">{product.howto}</p>
          <p className="m-0 text-[14px] leading-[1.55] opacity-75">{product.pack}</p>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="m-0 font-display text-[16px] font-bold">Warnhinweise</h3>
          <ul className="flex flex-col gap-3">
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-3 text-[16px] leading-[1.5] font-semibold">
                <WarningIcon color={product.colors.tablet_bottom} />
                {warning}
              </li>
            ))}
            {SUPPLEMENT_NOTICES.map((notice) => (
              <li key={notice} className="flex gap-3 text-[15px] leading-[1.5]">
                <InfoIcon />
                {notice}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
