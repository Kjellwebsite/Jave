import type { ReactElement } from 'react';
import type { ComponentSpec, MatrixContent, Panel } from '../../items/generators/matrix';
import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Frame } from '../ui';

const SHADES = ['#ffffff', '#d9dce0', '#a3a9b0', '#5c6168', '#181a1d'];
const ANGLES = [0, 15, 30, 45];
const SIDES = [3, 4, 5, 6, 0];

function polygon(sides: number, cx: number, cy: number, r: number, angle: number) {
  const pts: string[] = [];
  const offset = sides === 4 ? Math.PI / 4 : -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const a = offset + (i * 2 * Math.PI) / sides + (angle * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function Entity({ p, cx, cy, r }: { p: Panel; cx: number; cy: number; r: number }) {
  const fill = SHADES[p.shade];
  const common = { fill, stroke: '#181a1d', strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  if (SIDES[p.shape] === 0) return <circle cx={cx} cy={cy} r={r * 0.9} {...common} />;
  return <polygon points={polygon(SIDES[p.shape], cx, cy, r, ANGLES[p.angle])} {...common} />;
}

interface Region {
  x0: number;
  x1: number;
}

function ComponentView({ spec, p, region }: { spec: ComponentSpec; p: Panel; region: Region }) {
  const w = region.x1 - region.x0;
  const cx = region.x0 + w / 2;
  if (spec.layout === 'single') {
    const r = (w / 100) * [13, 17.5, 22, 26.5, 31][p.size];
    return <Entity p={p} cx={cx} cy={50} r={r} />;
  }
  const n = spec.layout === 'grid9' ? 3 : 2;
  const cells: ReactElement[] = [];
  const pad = w * 0.14;
  const step = (w - 2 * pad) / n;
  const stepY = (100 - 2 * 14) / n;
  const r = Math.min(step, stepY) * [0.2, 0.26, 0.32, 0.38, 0.44][p.size];
  for (let i = 0; i < n * n; i++) {
    if (!(p.mask & (1 << i))) continue;
    const col = i % n;
    const row = Math.floor(i / n);
    cells.push(<Entity key={i} p={p} cx={region.x0 + pad + step * (col + 0.5)} cy={14 + stepY * (row + 0.5)} r={r} />);
  }
  return <>{cells}</>;
}

export function MatrixPanel({ components, panels, size = 100 }: { components: ComponentSpec[]; panels: Panel[]; size?: number }) {
  const regions: Region[] = components.length === 1 ? [{ x0: 0, x1: 100 }] : [{ x0: 0, x1: 50 }, { x0: 50, x1: 100 }];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="mx-panel" aria-hidden="true">
      {components.length > 1 ? <line x1="50" y1="8" x2="50" y2="92" stroke="#c9cdd2" strokeWidth="0.6" strokeDasharray="1.5 2" /> : null}
      {components.map((c, i) => (
        <ComponentView key={i} spec={c} p={panels[i]} region={regions[i]} />
      ))}
    </svg>
  );
}

export default function MatrixItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<MatrixContent>) {
  const { components, cells, options } = item.content;
  return (
    <div className="task mx">
      <p className="task-prompt">Which option completes the matrix?</p>
      <Frame className="mx-frame" label="Matrix">
        <div className="mx-grid paper" role="img" aria-label="Three by three matrix of figures with the bottom-right cell missing">
          {cells.map((c, i) => (
            <div key={i} className="mx-cell">
              {i === 8 ? <span className="mx-missing">?</span> : <MatrixPanel components={components} panels={c} />}
            </div>
          ))}
        </div>
      </Frame>
      <ChoiceGrid
        className="mx-options"
        optionClassName="mx-option"
        columns={4}
        ariaLabel="Eight answer options"
        options={options.map((o, i) => (
          <span key={i} className="mx-option-panel paper">
            <MatrixPanel components={components} panels={o} />
          </span>
        ))}
        disabled={disabled}
        revealKey={reveal ? (item.key as number) : undefined}
        onSubmit={(index) => onAnswer({ kind: 'choice', index })}
      />
    </div>
  );
}
