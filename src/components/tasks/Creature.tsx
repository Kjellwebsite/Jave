import type { Stimulus } from '../../tasks/category';

/** Category-learning stimulus: shape, tone, size, stripe. Four binary features. */
export function Creature({ s, size = 120 }: { s: Stimulus; size?: number }) {
  const [shape, tone, big, stripe] = s;
  const fill = tone ? '#5c6168' : '#e2e5e9';
  const r = big ? 34 : 22;
  const id = `clip-${s.join('')}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${big ? 'large' : 'small'} ${tone ? 'dark' : 'light'} ${shape ? 'square' : 'circle'}${stripe ? ' with a stripe' : ''}`}>
      <defs>
        <clipPath id={id}>{shape ? <rect x={50 - r} y={50 - r} width={2 * r} height={2 * r} rx="4" /> : <circle cx="50" cy="50" r={r} />}</clipPath>
      </defs>
      {shape ? <rect x={50 - r} y={50 - r} width={2 * r} height={2 * r} rx="4" fill={fill} stroke="#181a1d" strokeWidth="1.5" /> : <circle cx="50" cy="50" r={r} fill={fill} stroke="#181a1d" strokeWidth="1.5" />}
      {stripe ? <rect x="0" y="46" width="100" height="8" fill={tone ? '#ffffff' : '#181a1d'} clipPath={`url(#${id})`} /> : null}
    </svg>
  );
}
