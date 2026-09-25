import { useState } from 'react';
import type { MetaReport } from '../../scoring/metacognition';
import type { EstimateView } from '../../scoring/report';
import { displayRank } from '../../scoring/rank';

export interface ProfileRow {
  id: string;
  index: number;
  label: string;
  estimate: EstimateView | null;
  experimental?: boolean;
}

const BANDS = [
  { from: -1.33, to: 0, label: 'Foundation' },
  { from: 0, to: 1, label: 'Standard' },
  { from: 1, to: 2, label: 'Advanced' },
  { from: 2, to: 3, label: 'Elite' },
  { from: 3, to: 4.5, label: 'Apex' },
];
const AXIS_MIN = -2.5;
const AXIS_MAX = 4.5;

/** Dot and 90% interval per domain on one θ axis. Single series, graphite ink. */
export function IntervalPlot({ rows }: { rows: ProfileRow[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 720;
  const left = 190;
  const right = 24;
  const rowH = 34;
  const top = 34;
  const H = top + rows.length * rowH + 30;
  const x = (t: number) => left + ((Math.max(AXIS_MIN, Math.min(AXIS_MAX, t)) - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (W - left - right);
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="interval-plot" role="img" aria-label="Domain estimates with 90 percent intervals on the provisional ability scale">
        {BANDS.map((b, i) => (
          <g key={b.label}>
            <rect x={x(b.from)} y={top - 8} width={x(b.to) - x(b.from)} height={rows.length * rowH + 8} fill={i % 2 ? 'var(--surface-2)' : 'transparent'} />
            <text x={(x(b.from) + x(b.to)) / 2} y={top - 16} textAnchor="middle" className="chart-band">
              {b.label}
            </text>
          </g>
        ))}
        {[-2, -1, 0, 1, 2, 3, 4].map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={top - 8} x2={x(t)} y2={top + rows.length * rowH} stroke="var(--line)" strokeWidth={t === 0 ? 1.2 : 1} />
            <text x={x(t)} y={top + rows.length * rowH + 18} textAnchor="middle" className="chart-tick">
              {t > 0 ? `+${t}` : t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH + rowH / 2;
          const e = r.estimate;
          return (
            <g
              key={r.id}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              className={`plot-row ${hover === r.id ? 'is-hover' : ''}`}
              tabIndex={0}
              onFocus={() => setHover(r.id)}
              onBlur={() => setHover(null)}
              aria-label={e ? `${r.label}: estimate ${e.theta.toFixed(2)}, interval ${e.lo.toFixed(2)} to ${e.hi.toFixed(2)}, ${e.n} items` : `${r.label}: not measured`}
            >
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + 4} className="chart-label">
                {String(r.index).padStart(2, '0')}  {r.label}
                {r.experimental ? ' ·' : ''}
              </text>
              {e ? (
                <>
                  <line x1={x(e.lo)} y1={y} x2={x(e.hi)} y2={y} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" opacity={0.55} />
                  <circle cx={x(e.theta)} cy={y} r="5.5" fill={r.experimental ? 'var(--surface)' : 'var(--text)'} stroke="var(--text)" strokeWidth="1.6" />
                  {e.ceiling ? <text x={x(e.hi) + 8} y={y + 4} className="chart-tick">≥</text> : null}
                  {hover === r.id ? (
                    <g>
                      <rect x={Math.min(x(e.theta) + 10, W - 200)} y={y - 30} width="190" height="24" rx="6" fill="var(--inverse-bg)" />
                      <text x={Math.min(x(e.theta) + 20, W - 190)} y={y - 14} className="chart-tip">
                        θ {e.theta.toFixed(2)} ± {e.se.toFixed(2)} · {e.n} items · {displayRank(e.rank)}
                      </text>
                    </g>
                  ) : null}
                </>
              ) : (
                <text x={left} y={y + 4} className="chart-tick">
                  Not measured
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Polar profile: estimate radius with the 90% interval as a band. Summary view only. */
export function PolarProfile({ rows }: { rows: ProfileRow[] }) {
  const S = 360;
  const c = S / 2;
  const R = 130;
  const r = (t: number) => ((Math.max(AXIS_MIN, Math.min(AXIS_MAX, t)) - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * R;
  const n = rows.length;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, t: number) => [c + Math.cos(angle(i)) * r(t), c + Math.sin(angle(i)) * r(t)];
  const measured = rows.map((row, i) => ({ row, i })).filter((x) => x.row.estimate);
  const poly = (f: (e: EstimateView) => number) => measured.map(({ row, i }) => pt(i, f(row.estimate!)).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="polar" role="img" aria-label="Polar profile of domain estimates">
      {[-2, 0, 2, 4].map((t) => (
        <circle key={t} cx={c} cy={c} r={r(t)} fill="none" stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '2 4'} />
      ))}
      {rows.map((row, i) => {
        const [x2, y2] = pt(i, AXIS_MAX);
        const [lx, ly] = [c + Math.cos(angle(i)) * (R + 22), c + Math.sin(angle(i)) * (R + 22)];
        return (
          <g key={row.id}>
            <line x1={c} y1={c} x2={x2} y2={y2} stroke="var(--line)" />
            <text x={lx} y={ly} textAnchor={Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end'} dominantBaseline="middle" className="chart-tick">
              {String(row.index).padStart(2, '0')}
            </text>
          </g>
        );
      })}
      {measured.length >= 3 ? (
        <>
          <polygon points={poly((e) => e.hi)} fill="var(--accent-soft)" opacity="0.7" stroke="none" />
          <polygon points={poly((e) => e.lo)} fill="var(--bg)" stroke="none" />
          <polygon points={poly((e) => e.theta)} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinejoin="round" />
        </>
      ) : null}
      {measured.map(({ row, i }) => {
        const [px, py] = pt(i, row.estimate!.theta);
        return <circle key={row.id} cx={px} cy={py} r="3.5" fill="var(--text)" />;
      })}
    </svg>
  );
}

/** Reliability diagram: mean confidence vs accuracy per bin, with the identity line. */
export function CalibrationCurve({ meta }: { meta: MetaReport }) {
  const S = 240;
  const p = 30;
  const x = (v: number) => p + v * (S - 2 * p);
  const y = (v: number) => S - p - v * (S - 2 * p);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="calib" role="img" aria-label="Calibration curve: accuracy against confidence">
      <rect x={p} y={p} width={S - 2 * p} height={S - 2 * p} fill="none" stroke="var(--line)" />
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--line-strong)" strokeDasharray="3 4" />
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <text x={x(v)} y={S - 10} textAnchor="middle" className="chart-tick">
            {v * 100}%
          </text>
          <text x={10} y={y(v) + 3} className="chart-tick">
            {v * 100}
          </text>
        </g>
      ))}
      {meta.curve.length > 1 ? <polyline points={meta.curve.map((b) => `${x(b.confidence)},${y(b.accuracy)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth="2" /> : null}
      {meta.curve.map((b, i) => (
        <circle key={i} cx={x(b.confidence)} cy={y(b.accuracy)} r={Math.min(9, 3 + b.n)} fill="var(--text)" stroke="var(--surface)" strokeWidth="2">
          <title>{`Confidence ${(b.confidence * 100).toFixed(0)}% → ${(b.accuracy * 100).toFixed(0)}% correct (${b.n} items)`}</title>
        </circle>
      ))}
    </svg>
  );
}
