'use client';

import { useState } from 'react';
import type { PointerEvent } from 'react';
import type { Effect } from '@/lib/products';
import {
  clock,
  NIGHT,
  plasmaLevel,
  plasmaPeak,
  STAGE_RANGES,
  STAGES,
  stageShares,
  type Stage,
} from '@/lib/sleep';
import { LAYER_COLORS, percent, signed, STAGE_COLORS } from './chartTokens';

/**
 * Forest-plot rows: each published effect as its mean with the 95 % confidence interval,
 * around zero. Values are labelled; hover or focus shows the interval.
 */
export function EffectPlot({
  effects,
  color = LAYER_COLORS[0],
}: {
  effects: Effect[];
  color?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const reach =
    Math.ceil(Math.max(...effects.flatMap((e) => [Math.abs(e.low), Math.abs(e.high)])) / 5) * 5;
  const x = (v: number) => ((v + reach) / (2 * reach)) * 100;
  const ticks = Array.from({ length: (2 * reach) / 5 + 1 }, (_, i) => -reach + i * 5);

  return (
    <div className="ch">
      <div className="ch-forest">
        {effects.map((effect, i) => (
          <div
            key={effect.label}
            className="ch-forest-row"
            tabIndex={0}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            aria-label={`${effect.label}: ${signed(effect.value, 2)} ${effect.unit}, 95-%-Konfidenzintervall ${signed(effect.low, 2)} bis ${signed(effect.high, 2)} ${effect.unit}`}
          >
            <span className="ch-forest-label">{effect.label}</span>
            <span className="ch-forest-track">
              <span className="ch-zero" style={{ left: `${x(0)}%` }} />
              <span
                className="ch-ci"
                style={{
                  left: `${x(effect.low)}%`,
                  width: `${x(effect.high) - x(effect.low)}%`,
                  background: color,
                }}
              />
              <span className="ch-dot" style={{ left: `${x(effect.value)}%`, background: color }} />
              {active === i && (
                <span className="ch-tip" style={{ left: `${x(effect.value)}%` }}>
                  <strong>
                    {signed(effect.value, 2)} {effect.unit}
                  </strong>
                  <span>
                    95-%-KI {signed(effect.low, 2)} bis {signed(effect.high, 2)}
                  </span>
                </span>
              )}
            </span>
            <span className="ch-forest-value">
              {signed(effect.value)} {effect.unit}
            </span>
          </div>
        ))}
        <div className="ch-forest-row ch-forest-axis" aria-hidden="true">
          <span />
          <span className="ch-forest-track">
            {ticks.map((tick) => (
              <span
                key={tick}
                data-minor={tick % 10 !== 0 || undefined}
                style={{ left: `${x(tick)}%` }}
              >
                {tick === 0 ? '0' : signed(tick, 0)}
              </span>
            ))}
          </span>
          <span />
        </div>
      </div>
      <div className="ch-forest-hint" aria-hidden="true">
        <span>← weniger</span>
        <span>mehr →</span>
      </div>
    </div>
  );
}

const BAR_ORDER: Exclude<Stage, 'W'>[] = ['N1', 'N2', 'N3', 'R'];

/** Share of each sleep stage in the schematic night: one stacked bar plus a legend. */
export function StageBar() {
  const [active, setActive] = useState<Stage | null>(null);
  const shares = stageShares();
  const label = (stage: Stage) => STAGES.find((s) => s.id === stage)!.long;

  return (
    <div className="ch">
      <div className="ch-stack" role="img" aria-label="Anteile der Schlafphasen, siehe Legende">
        {BAR_ORDER.map((stage) => (
          <span
            key={stage}
            className="ch-stack-seg"
            data-active={active === stage || undefined}
            style={{ flexGrow: shares[stage], background: STAGE_COLORS[stage] }}
            onPointerEnter={() => setActive(stage)}
            onPointerLeave={() => setActive(null)}
          >
            {active === stage && (
              <span className="ch-tip">
                <strong>{percent(shares[stage])}</strong>
                <span>{label(stage)}</span>
              </span>
            )}
          </span>
        ))}
      </div>
      <ul className="ch-legend">
        {BAR_ORDER.map((stage) => (
          <li
            key={stage}
            data-strong={stage === 'N3' || undefined}
            onPointerEnter={() => setActive(stage)}
            onPointerLeave={() => setActive(null)}
          >
            <span className="ch-swatch" style={{ background: STAGE_COLORS[stage] }} />
            <span className="grow">{label(stage)}</span>
            <strong>{percent(shares[stage])}</strong>
            <span className="ch-range">
              {STAGE_RANGES[stage][0]} bis {STAGE_RANGES[stage][1]} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Plasma level of one dose taken at lights out, relative to its peak, until the alarm.
 * Crosshair on hover; the morning value is labelled at the end of the line.
 */
export function DecayChart({
  halfLifeMinutes,
  color = LAYER_COLORS[0],
}: {
  halfLifeMinutes: number;
  color?: string;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const level = (minute: number) => plasmaLevel(minute / 60, halfLifeMinutes) * 100;
  const points: string[] = [];
  for (let m = 0; m <= NIGHT.minutes; m += 2) points.push(`${m} ${(100 - level(m)).toFixed(2)}`);
  const line = `M${points.join(' L')}`;
  const peakMinute = plasmaPeak(halfLifeMinutes) * 60;
  const end = level(NIGHT.minutes);
  const x = (minute: number) => (minute / NIGHT.minutes) * 100;

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setCursor(Math.round((share * NIGHT.minutes) / 5) * 5);
  };

  return (
    <div className="ch">
      <div className="ch-line">
        <div className="ch-yticks" aria-hidden="true">
          <span>100 %</span>
          <span>50 %</span>
          <span>0 %</span>
        </div>
        <div
          className="ch-line-plot"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setCursor(null)}
          role="img"
          aria-label={`Melatoninspiegel nach der Einnahme um ${clock(0)}: Spitze nach rund ${Math.round(peakMinute / 5) * 5} Minuten, um ${clock(NIGHT.minutes)} noch ${percent(end)} des Spitzenwerts.`}
        >
          <div className="ch-grid" style={{ top: 0 }} />
          <div className="ch-grid" style={{ top: '50%' }} />
          <div className="ch-grid ch-base" style={{ top: '100%' }} />
          <svg viewBox={`0 0 ${NIGHT.minutes} 100`} preserveAspectRatio="none" aria-hidden="true">
            <path d={`${line} L${NIGHT.minutes} 100 L0 100 Z`} fill={color} fillOpacity="0.1" />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="ch-end" style={{ background: color }} />
          <span className="ch-end-label">
            {clock(NIGHT.minutes)}: <strong>{percent(end)}</strong>
          </span>
          <span className="ch-peak-label" style={{ left: `${x(peakMinute)}%` }}>
            Spitze nach rund {Math.round(peakMinute / 5) * 5} min
          </span>
          {cursor !== null && (
            <>
              <div className="ch-cross" style={{ left: `${x(cursor)}%` }} />
              <span
                className="ch-tip ch-tip-top"
                data-flip={cursor > NIGHT.minutes * 0.6 || undefined}
                style={{ left: `${x(cursor)}%` }}
              >
                <strong>{percent(level(cursor))}</strong>
                <span>{clock(cursor)}</span>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="ch-xaxis" aria-hidden="true">
        {[0, 120, 240, 360, 480].map((minute) => (
          <span key={minute} style={{ left: `${x(minute)}%` }}>
            {clock(minute)}
          </span>
        ))}
      </div>
    </div>
  );
}
