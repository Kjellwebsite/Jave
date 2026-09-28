import type { CSSProperties } from 'react';
import type { Mote } from '@/lib/random';

export interface CloudSpec {
  left: string;
  top: string;
  width: string;
  height: string;
  color: string;
  duration: number;
  delay?: number;
}

/** Soft light clouds and twinkling dust, used behind tablets. Purely decorative. */
export function Ambient({
  clouds,
  motes,
  className,
  style,
}: {
  clouds: CloudSpec[];
  motes: Mote[];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" className={className} style={style}>
      {clouds.map((cloud, i) => (
        <div
          key={`c${i}`}
          className="cloud"
          style={{
            left: cloud.left,
            top: cloud.top,
            width: cloud.width,
            height: cloud.height,
            background: `radial-gradient(closest-side, ${cloud.color}, transparent)`,
            animationDuration: `${cloud.duration}s`,
            animationDelay: cloud.delay ? `${cloud.delay}s` : undefined,
          }}
        />
      ))}
      {motes.map((mote, i) => (
        <div
          key={`m${i}`}
          className="mote"
          style={{
            left: `${mote.x.toFixed(2)}%`,
            top: `${mote.y.toFixed(2)}%`,
            width: mote.size,
            height: mote.size,
            animationDelay: `${mote.delay}s`,
            animationDuration: `${mote.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
