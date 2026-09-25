import type { RuleCard as Card } from '../../tasks/rules';

/** Four greys and four shapes; count 1–4. Colour here is luminance, distinguishable without hue. */
const TONES = ['#181a1d', '#6b7178', '#b3b8be', '#ffffff'];
const TONE_NAMES = ['black', 'dark grey', 'light grey', 'white'];
const SHAPE_NAMES = ['triangle', 'star', 'cross', 'circle'];

const POS: [number, number][][] = [
  [[50, 65]],
  [[50, 40], [50, 90]],
  [[50, 30], [50, 65], [50, 100]],
  [[30, 42], [70, 42], [30, 88], [70, 88]],
];

function symbol(shape: number, x: number, y: number, fill: string, key: number) {
  const r = 12;
  const stroke = { stroke: '#181a1d', strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  switch (shape) {
    case 0:
      return <polygon key={key} points={`${x},${y - r} ${x + r},${y + r * 0.85} ${x - r},${y + r * 0.85}`} fill={fill} {...stroke} />;
    case 1: {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r * 1.05;
        pts.push(`${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`);
      }
      return <polygon key={key} points={pts.join(' ')} fill={fill} {...stroke} />;
    }
    case 2: {
      const w = r * 0.42;
      return <path key={key} d={`M${x - w},${y - r}h${2 * w}v${r - w}h${r - w}v${2 * w}h${-(r - w)}v${r - w}h${-2 * w}v${-(r - w)}h${-(r - w)}v${-2 * w}h${r - w}z`} fill={fill} {...stroke} />;
    }
    default:
      return <circle key={key} cx={x} cy={y} r={r * 0.95} fill={fill} {...stroke} />;
  }
}

export function RuleCardView({ card }: { card: Card }) {
  const label = `${card.count + 1} ${TONE_NAMES[card.color]} ${SHAPE_NAMES[card.shape]}${card.count ? 's' : ''}`;
  return (
    <svg viewBox="0 0 100 130" className="rule-card" role="img" aria-label={label}>
      <rect x="1" y="1" width="98" height="128" rx="8" fill="#ffffff" stroke="#c9cdd2" />
      {POS[card.count].map(([x, y], i) => symbol(card.shape, x, y, TONES[card.color], i))}
    </svg>
  );
}
