import { motion, useReducedMotion } from 'motion/react';

/** Hero geometry: a measurement dial with slowly drifting rings. Decorative. */
export function Instrument() {
  const reduce = useReducedMotion();
  const ticks = Array.from({ length: 120 }, (_, i) => i);
  const spin = (duration: number, dir = 1) =>
    reduce ? {} : { animate: { rotate: 360 * dir }, transition: { duration, ease: 'linear' as const, repeat: Infinity } };
  return (
    <svg className="instrument" viewBox="-200 -200 400 400" role="img" aria-label="Measurement dial illustration">
      <defs>
        <linearGradient id="inst-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--aluminium)" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="var(--steel)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--aluminium)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <circle r="186" fill="none" stroke="var(--line)" />
      <motion.g style={{ originX: '0px', originY: '0px' }} {...spin(240)}>
        {ticks.map((i) => {
          const a = (i / ticks.length) * Math.PI * 2;
          const long = i % 10 === 0;
          const r1 = long ? 162 : 170;
          return (
            <line
              key={i}
              x1={Math.cos(a) * r1}
              y1={Math.sin(a) * r1}
              x2={Math.cos(a) * 178}
              y2={Math.sin(a) * 178}
              stroke={long ? 'var(--steel)' : 'var(--aluminium)'}
              strokeWidth={long ? 1.2 : 0.7}
            />
          );
        })}
      </motion.g>
      <motion.g style={{ originX: '0px', originY: '0px' }} {...spin(160, -1)}>
        <circle r="132" fill="none" stroke="url(#inst-metal)" strokeWidth="1" strokeDasharray="2 6" />
        <circle cx="132" cy="0" r="3" fill="var(--graphite)" className="instrument-dot" />
      </motion.g>
      <circle r="96" fill="none" stroke="var(--line-strong)" />
      <motion.g style={{ originX: '0px', originY: '0px' }} {...spin(90)}>
        <path d="M -96 0 A 96 96 0 0 1 58 -76" fill="none" stroke="var(--text)" strokeWidth="1.4" strokeLinecap="round" />
      </motion.g>
      <circle r="54" fill="none" stroke="var(--line)" />
      <line x1="-200" y1="0" x2="200" y2="0" stroke="var(--line)" />
      <line x1="0" y1="-200" x2="0" y2="200" stroke="var(--line)" />
      <circle r="4" fill="none" stroke="var(--text)" />
      <text x="10" y="-62" className="instrument-label">θ̂</text>
      <text x="104" y="-14" className="instrument-label">±SE</text>
      <text x="-190" y="-8" className="instrument-label">−4</text>
      <text x="172" y="-8" className="instrument-label">+6</text>
    </svg>
  );
}
