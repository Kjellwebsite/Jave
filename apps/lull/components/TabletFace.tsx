import type { CSSProperties, ReactNode } from 'react';
import { flatEdge, flatFace, type TabletPalette } from '@/lib/tablet';

export interface TabletFaceProps {
  palette: TabletPalette;
  /** Diameter in px. */
  size: number;
  /** Thickness of each colored rim below the face, in px. */
  edge: number;
  /** Drop shadow appended to the rim shadows. */
  drop: string;
  ring?: string;
  /** Extra shadow in front of the rim, e.g. the selection ring in the product rail. */
  outline?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A tablet seen from above: the white face with its colored rims as stacked shadows. */
export function TabletFace({
  palette,
  size,
  edge,
  drop,
  ring,
  outline,
  className,
  style,
  children,
}: TabletFaceProps) {
  const shadow = flatEdge(palette, edge, drop, ring);
  return (
    <div
      aria-hidden="true"
      className={['flat-face', className ?? ''].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        background: flatFace(palette),
        boxShadow: outline ? `${outline}, ${shadow}` : shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Stars({
  percent,
  size,
  base,
  fill,
}: {
  /** Filled width, 0 to 100. */
  percent: number;
  size: number;
  /** Style of the empty stars (color or opacity). */
  base: CSSProperties;
  fill: string;
}) {
  return (
    <span aria-hidden="true" className="stars" style={{ fontSize: size }}>
      <span style={base}>★★★★★</span>
      <span className="stars-fill" style={{ width: `${percent}%`, color: fill }}>
        ★★★★★
      </span>
    </span>
  );
}
