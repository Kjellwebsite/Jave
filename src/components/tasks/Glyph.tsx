import type { BalanceSymbol } from '../../items/generators/balance';

/** Monochrome symbols for balance items. Distinct in shape, not colour. */
export function SymbolGlyph({ s, size = 18 }: { s: BalanceSymbol; size?: number }) {
  const h = size / 2;
  const common = { fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1 };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="glyph">
      {s === 'circle' ? <circle cx={h} cy={h} r={h * 0.82} {...common} fill="none" strokeWidth={1.6} /> : null}
      {s === 'triangle' ? <polygon points={`${h},${size * 0.1} ${size * 0.92},${size * 0.88} ${size * 0.08},${size * 0.88}`} {...common} /> : null}
      {s === 'square' ? <rect x={size * 0.12} y={size * 0.12} width={size * 0.76} height={size * 0.76} {...common} fill="none" strokeWidth={1.6} /> : null}
      {s === 'hexagon' ? (
        <polygon
          points={Array.from({ length: 6 }, (_, i) => {
            const a = (Math.PI / 3) * i;
            return `${h + h * 0.85 * Math.cos(a)},${h + h * 0.85 * Math.sin(a)}`;
          }).join(' ')}
          {...common}
        />
      ) : null}
    </svg>
  );
}

export const SYMBOL_NAME: Record<BalanceSymbol, string> = { circle: 'circle', triangle: 'triangle', square: 'square', hexagon: 'hexagon' };
