'use client';

import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { ReleaseMatrix } from '@/lib/products';
import {
  clock,
  HYPNOGRAM,
  NIGHT,
  released,
  STAGE_RANGES,
  STAGES,
  stageAt,
  stageMinutes,
  stageShares,
  type Stage,
} from '@/lib/sleep';
import { LAYER_COLORS, percent, STAGE_COLORS } from './chartTokens';

const pct = (minute: number) => (minute / NIGHT.minutes) * 100;
const ROW = 26;
const BAR = 12;
const STEP = 5;
/** Clock ticks every full hour, plus the start and the end of the night. */
const TICKS = [0, ...Array.from({ length: 8 }, (_, i) => 30 + i * 60), NIGHT.minutes];

function rowOf(stage: Stage): number {
  return STAGES.findIndex((s) => s.id === stage);
}

function windowOf(layer: ReleaseMatrix['layers'][number]) {
  return { start: layer.start ?? 0, end: layer.end ?? 0 };
}

/** Line of a cumulative release curve in a 480 x 100 box (y down). */
function curve(window: { start: number; end: number }): string {
  const points: string[] = [];
  for (let m = 0; m <= NIGHT.minutes; m += 2) {
    points.push(`${m} ${(100 - released(window, m / 60) * 100).toFixed(2)}`);
  }
  return `M${points.join(' L')}`;
}

/**
 * "Eine Nacht mit Drift": the sleep stages of a typical night above the target release
 * profile of the two active layers, on one time axis. A crosshair (pointer or arrow keys)
 * reads both at once; a table below carries every value.
 */
export function NightChart({ release }: { release: ReleaseMatrix }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const id = useId();
  const active = release.layers.slice(0, 2).map(windowOf);
  const [top, core] = active as [{ start: number; end: number }, { start: number; end: number }];
  const curves = active.map(curve);
  const bands = [
    { title: release.phases[0]!.title, from: 0, to: top.end * 60, tone: 'nc-band-in' },
    {
      title: release.phases[1]!.title,
      from: top.end * 60,
      to: core.end * 60,
      tone: 'nc-band-through',
    },
    {
      title: release.phases[2]!.title,
      from: core.end * 60,
      to: NIGHT.minutes,
      tone: 'nc-band-wake',
    },
  ];

  const readout = (minute: number) => {
    const stage = STAGES[rowOf(stageAt(minute))]!;
    const values = active.map((window) => percent(released(window, minute / 60) * 100));
    return { time: clock(minute), stage, values };
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setCursor(Math.round((x * NIGHT.minutes) / STEP) * STEP);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, (m: number) => number> = {
      ArrowRight: (m) => m + (event.shiftKey ? 60 : 10),
      ArrowLeft: (m) => m - (event.shiftKey ? 60 : 10),
      Home: () => 0,
      End: () => NIGHT.minutes,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = Math.min(NIGHT.minutes, Math.max(0, move(cursor ?? 0)));
    setCursor(next);
    const { time, stage, values } = readout(next);
    setAnnounce(
      `${time}: ${stage.long}. ${release.layers[0]!.name} ${values[0]} freigesetzt, ` +
        `${release.layers[1]!.name} ${values[1]} freigesetzt.`,
    );
  };

  const tip = cursor === null ? null : readout(cursor);
  const shares = stageShares();
  const minutes = stageMinutes();
  const rows = [0, 15, 30, 90, 150, 210, 270, 330, core.end * 60];
  // Direct label of the core curve, just under the curve at 60 % of its window.
  const coreLabelHour = core.start + (core.end - core.start) * 0.6;

  return (
    <figure className="nc m-0" aria-labelledby={`${id}-title`}>
      <div className="nc-head">
        <div className="flex flex-col gap-1.5">
          <h3 id={`${id}-title`} className="m-0 font-serif text-[30px] leading-[1.1] font-normal">
            Eine Nacht mit Drift
          </h3>
          <p className="m-0 max-w-[560px] text-[14px] leading-[1.5] opacity-75">
            Typischer Schlafverlauf eines gesunden Erwachsenen und Zielprofil der Freisetzung,
            Einnahme um {clock(0)}. Schematisch, keine Messwerte.
          </p>
        </div>
        <ul className="nc-legend" aria-label="Legende">
          {release.layers.slice(0, 2).map((layer, i) => (
            <li key={layer.name}>
              <span className="nc-key" style={{ background: LAYER_COLORS[i] }} />
              {layer.name}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="nc-body"
        tabIndex={0}
        role="group"
        aria-label="Schlafphasen und Freisetzung im Verlauf der Nacht. Pfeiltasten bewegen die Zeitmarke."
        aria-describedby={`${id}-table`}
        onKeyDown={onKey}
        onFocus={() => setCursor((c) => c ?? 60)}
        onBlur={() => setCursor(null)}
      >
        <div className="nc-labels" aria-hidden="true">
          <div className="nc-phase-spacer" />
          {STAGES.map((stage) => (
            <span key={stage.id} className="nc-rowlabel" style={{ height: ROW }}>
              {stage.label}
            </span>
          ))}
          <div className="nc-gap" />
          <div className="nc-yticks">
            <span>100 %</span>
            <span>50 %</span>
            <span>0 %</span>
          </div>
        </div>

        <div
          className="nc-plot"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setCursor(null)}
        >
          <div className="nc-phases" aria-hidden="true">
            {bands.slice(1).map((band) => (
              <i key={band.title} style={{ left: `${pct(band.from)}%` }} />
            ))}
            {bands.map((band, k) => (
              <span
                key={band.title}
                data-first={k === 0 || undefined}
                style={{ left: `${pct(k === 0 ? 0 : (band.from + band.to) / 2)}%` }}
              >
                {band.title}
              </span>
            ))}
          </div>

          <div className="nc-canvas">
            {bands.map((band) => (
              <div
                key={band.title}
                aria-hidden="true"
                className={`nc-band ${band.tone}`}
                style={{ left: `${pct(band.from)}%`, width: `${pct(band.to - band.from)}%` }}
              />
            ))}

            <div className="nc-hypno" style={{ height: ROW * STAGES.length }} aria-hidden="true">
              {STAGES.map((stage, row) => (
                <div key={stage.id} className="nc-grid" style={{ top: row * ROW + ROW / 2 }} />
              ))}
              {HYPNOGRAM.slice(1).map((segment, i) => {
                const a = rowOf(HYPNOGRAM[i]!.stage);
                const b = rowOf(segment.stage);
                return (
                  <div
                    key={`c${segment.start}`}
                    className="nc-step"
                    style={{
                      left: `${pct(segment.start)}%`,
                      top: Math.min(a, b) * ROW + ROW / 2,
                      height: Math.abs(a - b) * ROW,
                    }}
                  />
                );
              })}
              {HYPNOGRAM.map((segment) => (
                <div
                  key={segment.start}
                  className={segment.stage === 'N3' ? 'nc-seg nc-seg-deep' : 'nc-seg'}
                  style={{
                    left: `${pct(segment.start)}%`,
                    width: `${pct(segment.end - segment.start)}%`,
                    top: rowOf(segment.stage) * ROW + (ROW - BAR) / 2,
                    height: BAR,
                    background: STAGE_COLORS[segment.stage],
                  }}
                />
              ))}
            </div>

            <div className="nc-gap" />

            <div className="nc-release" aria-hidden="true">
              <div className="nc-grid" style={{ top: 0 }} />
              <div className="nc-grid" style={{ top: '50%' }} />
              <div className="nc-grid nc-base" style={{ top: '100%' }} />
              <svg viewBox={`0 0 ${NIGHT.minutes} 100`} preserveAspectRatio="none">
                {curves.map((line, i) => (
                  <path
                    key={i}
                    d={line}
                    fill="none"
                    stroke={LAYER_COLORS[i]}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              <span className="nc-direct" style={{ left: `${pct(top.end * 60 + 12)}%`, top: 8 }}>
                {release.layers[0]!.name}
              </span>
              <span
                className="nc-direct"
                style={{
                  left: `${pct(coreLabelHour * 60)}%`,
                  top: `calc(${(100 - released(core, coreLabelHour) * 100).toFixed(1)}% + 10px)`,
                }}
              >
                {release.layers[1]!.name}
              </span>
            </div>

            {tip && cursor !== null && (
              <>
                <div className="nc-cross" style={{ left: `${pct(cursor)}%` }} />
                <div
                  className="nc-tip"
                  data-flip={cursor > NIGHT.minutes * 0.6 || undefined}
                  style={{ left: `${pct(cursor)}%` }}
                >
                  <strong className="text-[15px]">{tip.time}</strong>
                  <span className="nc-tip-row">
                    <span
                      className="nc-tip-swatch"
                      style={{ background: STAGE_COLORS[tip.stage.id] }}
                    />
                    {tip.stage.long}
                  </span>
                  {release.layers.slice(0, 2).map((layer, i) => (
                    <span key={layer.name} className="nc-tip-row">
                      <span className="nc-key" style={{ background: LAYER_COLORS[i] }} />
                      <strong>{tip.values[i]}</strong>
                      <span className="opacity-70">{layer.name}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="nc-axis" aria-hidden="true">
            {TICKS.map((minute) => (
              <span
                key={minute}
                data-minor={(minute - 90) % 120 !== 0 || undefined}
                style={{ left: `${pct(minute)}%` }}
              >
                {clock(minute)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ul className="nc-phase-list">
        {bands.map((band) => (
          <li key={band.title}>
            <strong>{band.title}</strong> {clock(band.from)} bis {clock(band.to)}
          </li>
        ))}
      </ul>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <details className="nc-details" id={`${id}-table`}>
        <summary>Werte als Tabelle</summary>
        <div className="nc-tables">
          <table>
            <caption>Schlafphasen der typischen Nacht</caption>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Minuten</th>
                <th scope="col">Anteil am Schlaf</th>
                <th scope="col">Richtwert</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => (
                <tr key={stage.id}>
                  <th scope="row">{stage.long}</th>
                  <td>{minutes[stage.id]}</td>
                  <td>{stage.id === 'W' ? '–' : percent(shares[stage.id])}</td>
                  <td>
                    {stage.id === 'W'
                      ? '–'
                      : `${STAGE_RANGES[stage.id][0]} bis ${STAGE_RANGES[stage.id][1]} %`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>Freisetzung, Zielprofil</caption>
            <thead>
              <tr>
                <th scope="col">Uhrzeit</th>
                {release.layers.slice(0, 2).map((layer) => (
                  <th key={layer.name} scope="col">
                    {layer.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((minute) => (
                <tr key={minute}>
                  <th scope="row">{clock(minute)}</th>
                  {active.map((window, i) => (
                    <td key={i}>{percent(released(window, minute / 60) * 100)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
