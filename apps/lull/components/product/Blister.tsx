import { flatFace } from '@/lib/tablet';
import { palette, type Product } from '@/lib/products';

/** Rotation of each tablet's break score, so the blister does not look copy-pasted. */
const SCORE_ANGLES = [12, -28, 40, 5, -15, 62, -40, 22, -8, 35, -52, 18, -2, 48];

/** The foil blister, 2 x 7 domed cells, in CSS only. Sized by `--bu` (see .blister-area). */
export function Blister({ product }: { product: Product }) {
  const colors = palette(product);
  const face = flatFace(colors);
  const edge = `inset 0 0 0 1px rgba(255,255,255,0.7), 0 2px 0 ${colors.mid}, 0 4px 0 ${colors.bottom}, 0 6px 6px rgba(20,10,40,0.3)`;
  const unit = (px: number) => `calc(var(--bu) * ${px})`;

  return (
    <div className="blister-stage" aria-hidden="true">
      <div className="blister">
        <div className="blister-label">
          <div className="flex flex-col" style={{ gap: unit(4) }}>
            <span
              className="font-serif leading-none"
              style={{ fontSize: unit(34), color: product.colors.button_ink }}
            >
              Lull
            </span>
            <span
              className="font-display font-extrabold"
              style={{ fontSize: unit(15), letterSpacing: unit(2), color: colors.mid }}
            >
              {product.name.toUpperCase()}
            </span>
          </div>
          <span
            className="font-display leading-[1.5] font-semibold text-[rgba(40,40,60,0.55)]"
            style={{ fontSize: unit(10), letterSpacing: unit(1) }}
          >
            14 TABLETTEN
            <br />
            {product.category.toUpperCase()}
          </span>
        </div>
        <div className="blister-grid">
          {SCORE_ANGLES.map((angle, i) => (
            <div key={i} className="cell">
              <div className="dome">
                <div
                  className="flex items-center justify-center rounded-full"
                  style={{ width: unit(42), height: unit(42), background: face, boxShadow: edge }}
                >
                  <div className="btab-score" style={{ transform: `rotate(${angle}deg)` }} />
                </div>
                <div className="dome-glare" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
