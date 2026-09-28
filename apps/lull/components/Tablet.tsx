import type { CSSProperties } from 'react';
import { buildTablet, FACE_SCALE, type TabletGeometry, type TabletPalette } from '@/lib/tablet';

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

/** Pushes a disc along Z by a fraction of the diameter (`--tab-s`), plus a fixed offset. */
export function depth(z: number, extraPx = 0): string {
  const offset = extraPx === 0 ? '' : ` ${extraPx < 0 ? '-' : '+'} ${Math.abs(extraPx)}px`;
  return `translateZ(calc(var(--tab-s) * ${z.toFixed(5)}${offset}))`;
}

/** The top face: powder grain, debossed "LULL" and product code, break score, travelling glare. */
export function TabletTopFace({
  geometry,
  code,
  shineDelay,
  shine = true,
}: {
  geometry: TabletGeometry;
  code: string;
  shineDelay?: number;
  shine?: boolean;
}) {
  return (
    <div
      className="layer face-top"
      style={{
        transform: `${depth(geometry.faceZ, 0.6)} scale(${FACE_SCALE})`,
        background: geometry.faceTop,
      }}
    >
      <div className="grain-face" />
      <div className="imprint">LULL</div>
      <div className="score" />
      <div className="imprint">{code}</div>
      {shine && (
        <>
          <div
            className="shine"
            style={shineDelay === undefined ? undefined : { animationDelay: `${shineDelay}s` }}
          />
          <div className="shine-2" />
        </>
      )}
    </div>
  );
}

export function TabletBottomFace({ geometry }: { geometry: TabletGeometry }) {
  return (
    <div
      className="layer"
      style={{
        transform: `${depth(-geometry.faceZ, -0.6)} scale(${FACE_SCALE})`,
        background: geometry.faceBottom,
      }}
    />
  );
}

export interface TabletProps {
  palette: TabletPalette;
  /** Debossed product code, e.g. "CALM". */
  code: string;
  /** Diameter as a CSS length. Omit to inherit `--tab-s` from a parent. */
  size?: string;
  /** Number of stacked discs. More is smoother and heavier; 32 to 48 is the design range. */
  layers?: number;
  /** On phones, render every other disc only. */
  lite?: boolean;
  /** Seconds; negative values start the tilt mid-cycle so several tablets do not move in sync. */
  tiltDelay?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The 3D tablet, pure CSS: stacked discs with `translateZ` in a `preserve-3d` container
 * (see lib/tablet.ts). Decorative, so hidden from assistive technology; the surrounding copy
 * names the product. Float, shadow and entry animations are added by the caller.
 */
export function Tablet({
  palette,
  code,
  size,
  layers = 40,
  lite = false,
  tiltDelay,
  className,
  style,
}: TabletProps) {
  const geometry = buildTablet(palette, layers);
  const rootStyle: CssVars = { ...style };
  if (size) rootStyle['--tab-s'] = size;
  const delay = tiltDelay === undefined ? undefined : `${tiltDelay}s`;

  return (
    <div
      aria-hidden="true"
      className={['tablet', lite ? 'tablet-lite' : '', className ?? ''].filter(Boolean).join(' ')}
      style={rootStyle}
    >
      <div className="pill" style={delay ? { animationDelay: delay } : undefined}>
        <TabletBottomFace geometry={geometry} />
        {geometry.layers.map((layer, i) => (
          <div
            key={i}
            // The first and last discs always stay so the silhouette keeps its domes.
            className={i % 2 === 1 && i !== layers - 1 ? 'layer layer-odd' : 'layer'}
            style={{
              transform: `${depth(layer.z)} scale(${layer.scale.toFixed(3)})`,
              background: layer.background,
            }}
          />
        ))}
        <TabletTopFace geometry={geometry} code={code} shineDelay={tiltDelay} />
      </div>
    </div>
  );
}
