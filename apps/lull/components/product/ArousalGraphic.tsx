'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { mix } from '@/lib/color';

/**
 * Schematic, not measured: a brain whose neurons fire fast and chaotically when tense and
 * slower when calmer, an EEG-style trace (jagged vs. smooth alpha rhythm) and the balance of
 * excitation (glutamate) and inhibition (GABA). Animated with requestAnimationFrame on the
 * SVG directly, only while visible; static with prefers-reduced-motion.
 */

const HOT = '#ff4d7d';
const COOL = '#6f9dff';

/** Neuron positions inside the brain outline (viewBox 400 x 300). */
const NODES: [number, number][] = [
  [92, 122],
  [118, 92],
  [150, 70],
  [186, 58],
  [226, 52],
  [264, 60],
  [300, 80],
  [326, 108],
  [334, 142],
  [112, 158],
  [142, 130],
  [176, 104],
  [212, 94],
  [246, 100],
  [282, 116],
  [306, 146],
  [152, 172],
  [190, 150],
  [230, 138],
  [266, 160],
  [206, 186],
  [300, 178],
];

/** Each neuron links to its three nearest neighbours. */
const EDGES: [number, number][] = (() => {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  NODES.forEach(([x, y], i) => {
    NODES.map(([x2, y2], j) => ({ j, d: (x - x2) ** 2 + (y - y2) ** 2 }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([Math.min(i, j), Math.max(i, j)]);
        }
      });
  });
  return edges;
})();

const BRAIN = [
  'M84 200 C52 184 40 140 58 106 C76 70 126 44 186 42 C236 38 292 48 326 80',
  'C354 106 364 144 350 172 C344 184 334 192 322 196',
  // Cerebellum, then the brainstem.
  'C342 206 346 234 324 248 C304 260 276 258 260 246',
  'C258 256 259 266 262 276 C256 286 238 286 232 276 C230 262 229 248 227 236',
  // Underside of the temporal lobe back to the frontal lobe.
  'C204 240 158 238 132 222 C118 214 110 206 100 204 C94 204 88 203 84 200 Z',
].join(' ');

const SULCI = [
  'M200 44 C192 80 212 110 196 150',
  'M120 190 C152 172 198 160 252 158',
  'M84 116 C104 102 122 118 146 104',
  'M146 64 C166 82 156 106 176 118',
  'M252 50 C238 84 266 106 254 134',
  'M294 72 C308 100 290 124 314 150',
  'M126 146 C148 136 166 150 188 140',
  'M150 206 C176 200 204 206 232 200',
  'M270 212 C290 208 314 212 334 222',
  'M266 228 C286 226 310 230 330 236',
  'M272 243 C288 244 304 246 318 245',
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** EEG-like trace for calmness `s` (0 tense, 1 calm) at phase `t` in seconds. */
function wavePath(s: number, t: number): string {
  let d = '';
  for (let x = 0; x <= 400; x += 4) {
    const busy =
      12 * Math.sin(x * 0.19 + t * 7.5) +
      7 * Math.sin(x * 0.47 + t * 11) +
      5 * Math.sin(x * 0.93 + t * 17) * Math.sin(x * 0.05 + t * 2);
    const calm = 11 * Math.sin(x * 0.075 + t * 2.2) * (0.72 + 0.28 * Math.sin(x * 0.013 + t * 0.6));
    const y = 32 + lerp(busy, calm, s);
    d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)} `;
  }
  return d;
}

interface Signal {
  edge: number;
  from: number;
  start: number;
  duration: number;
}

export function ArousalGraphic({ busyLabel, calmLabel }: { busyLabel: string; calmLabel: string }) {
  const [target, setTarget] = useState(0);
  const [touched, setTouched] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const waveRef = useRef<SVGPathElement>(null);
  const excitationRef = useRef<HTMLSpanElement>(null);
  const inhibitionRef = useRef<HTMLSpanElement>(null);
  const heatRef = useRef<SVGStopElement>(null);
  const targetRef = useRef(0);
  const stateRef = useRef(0);
  const paintRef = useRef<((s: number) => void) | null>(null);
  const gradientId = useId().replace(/:/g, '');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    targetRef.current = target;
    // Without motion the state jumps and is painted once per change.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stateRef.current = target;
      paintRef.current?.(target);
    }
  }, [target]);

  // Tell the story once: tense at first, calmer shortly after the graphic comes into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || touched || typeof IntersectionObserver === 'undefined') return;
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          timer = window.setTimeout(() => setTarget(1), 1600);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [touched]);

  useEffect(() => {
    const svg = svgRef.current;
    const root = rootRef.current;
    if (!svg || !root) return;
    const nodes = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-node]'));
    const glows = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-glow]'));
    const edges = Array.from(svg.querySelectorAll<SVGLineElement>('[data-edge]'));
    const dots = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-signal]'));
    const energy = NODES.map(() => 0);
    const edgeGlow = EDGES.map(() => 0);
    let signals: Signal[] = [];
    let frame = 0;
    let last = performance.now();
    let clock = 0;
    let visible = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const paint = (s: number) => {
      const color = mix(HOT, COOL, s);
      waveRef.current?.setAttribute('d', wavePath(s, clock));
      waveRef.current?.setAttribute('stroke', color);
      heatRef.current?.setAttribute('stop-color', color);
      heatRef.current?.setAttribute('stop-opacity', lerp(0.42, 0.16, s).toFixed(3));
      nodes.forEach((node, i) => {
        const e = energy[i] ?? 0;
        node.setAttribute('r', (2.6 + e * 2.6).toFixed(2));
        node.setAttribute('fill', mix(mix(HOT, COOL, s), '#ffffff', e * 0.55));
        glows[i]?.setAttribute('opacity', (e * 0.7).toFixed(3));
        glows[i]?.setAttribute('fill', color);
      });
      edges.forEach((edge, i) => {
        edge.setAttribute('stroke-opacity', (0.16 + (edgeGlow[i] ?? 0) * 0.55).toFixed(3));
        edge.setAttribute('stroke', color);
      });
      dots.forEach((dot, k) => {
        const signal = signals[k];
        if (!signal) {
          dot.setAttribute('opacity', '0');
          return;
        }
        const [a, b] = EDGES[signal.edge]!;
        const [from, to] = signal.from === a ? [a, b] : [b, a];
        const p = Math.min(1, (clock - signal.start) / signal.duration);
        const [x1, y1] = NODES[from]!;
        const [x2, y2] = NODES[to]!;
        dot.setAttribute('cx', lerp(x1, x2, p).toFixed(1));
        dot.setAttribute('cy', lerp(y1, y2, p).toFixed(1));
        dot.setAttribute('opacity', (1 - p * 0.4).toFixed(2));
        dot.setAttribute('fill', color);
      });
      if (excitationRef.current)
        excitationRef.current.style.width = `${lerp(86, 42, s).toFixed(1)}%`;
      if (inhibitionRef.current)
        inhibitionRef.current.style.width = `${lerp(30, 66, s).toFixed(1)}%`;
    };

    const step = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      // Ease the state towards the chosen side over roughly a second and a half.
      stateRef.current += (targetRef.current - stateRef.current) * Math.min(1, dt * 2.2);
      const s = stateRef.current;
      const rate = lerp(2.4, 0.22, s); // spikes per neuron per second
      NODES.forEach((_, i) => {
        energy[i] = Math.max(0, (energy[i] ?? 0) - dt * lerp(5, 2.2, s));
        if (Math.random() < rate * dt) {
          energy[i] = 1;
          const options = EDGES.map((edge, index) => ({ edge, index })).filter(
            ({ edge }) => edge[0] === i || edge[1] === i,
          );
          const pick = options[Math.floor(Math.random() * options.length)];
          if (pick && signals.length < dots.length) {
            signals.push({
              edge: pick.index,
              from: i,
              start: clock,
              duration: lerp(0.28, 0.95, s),
            });
          }
        }
      });
      signals = signals.filter((signal) => {
        const done = clock - signal.start >= signal.duration;
        if (done) {
          const [a, b] = EDGES[signal.edge]!;
          const to = signal.from === a ? b : a;
          energy[to] = Math.max(energy[to] ?? 0, 0.7);
        }
        return !done;
      });
      EDGES.forEach((_, i) => {
        edgeGlow[i] = Math.max(0, (edgeGlow[i] ?? 0) - dt * 3);
      });
      signals.forEach((signal) => {
        edgeGlow[signal.edge] = 1;
      });
      paint(s);
      if (visible) frame = requestAnimationFrame(step);
    };

    paintRef.current = paint;
    if (reduced.matches) {
      stateRef.current = targetRef.current;
      paint(stateRef.current);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const choose = (value: number, focus = false) => {
    setTouched(true);
    setTarget(value);
    if (focus) buttons.current[value]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      choose(target === 0 ? 1 : 0, true);
    }
  };

  return (
    <div ref={rootRef} className="arousal">
      <div role="radiogroup" aria-label="Zustand der Darstellung" className="arousal-toggle">
        {[busyLabel, calmLabel].map((label, value) => (
          <button
            key={label}
            ref={(el) => {
              buttons.current[value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={target === value}
            tabIndex={target === value ? 0 : -1}
            onClick={() => choose(value)}
            onKeyDown={onKey}
            className="arousal-option"
            data-active={target === value || undefined}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: value === 0 ? HOT : COOL }}
            />
            {label}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 400 290"
        className="arousal-brain"
        role="img"
        aria-label="Schematische Darstellung eines Gehirns: angespannt feuern viele Nervenzellen schnell und ungeordnet, ruhiger feuern sie seltener."
      >
        <defs>
          <radialGradient id={`${gradientId}-heat`} cx="50%" cy="45%" r="60%">
            <stop ref={heatRef} offset="0" stopColor={HOT} stopOpacity="0.42" />
            <stop offset="1" stopColor={HOT} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${gradientId}-clip`}>
            <path d={BRAIN} />
          </clipPath>
        </defs>
        <path d={BRAIN} className="brain-fill" />
        <rect
          x="30"
          y="20"
          width="350"
          height="260"
          fill={`url(#${gradientId}-heat)`}
          clipPath={`url(#${gradientId}-clip)`}
        />
        {SULCI.map((d) => (
          <path key={d} d={d} className="brain-sulcus" />
        ))}
        <path d={BRAIN} className="brain-outline" />
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            data-edge
            x1={NODES[a]![0]}
            y1={NODES[a]![1]}
            x2={NODES[b]![0]}
            y2={NODES[b]![1]}
            stroke={HOT}
            strokeOpacity="0.16"
            strokeWidth="1.2"
          />
        ))}
        {NODES.map(([x, y], i) => (
          <circle
            key={`g${i}`}
            data-glow
            cx={x}
            cy={y}
            r="9"
            fill={HOT}
            opacity="0"
            style={{ filter: 'blur(3px)' }}
          />
        ))}
        {NODES.map(([x, y], i) => (
          <circle key={`n${i}`} data-node cx={x} cy={y} r="2.6" fill={HOT} />
        ))}
        {Array.from({ length: 28 }, (_, k) => (
          <circle key={`s${k}`} data-signal cx="0" cy="0" r="2.2" fill={HOT} opacity="0" />
        ))}
      </svg>

      <div className="arousal-eeg">
        <span className="arousal-caption">Hirnstrom, schematisch</span>
        <svg viewBox="0 0 400 64" preserveAspectRatio="none" aria-hidden="true">
          <path
            ref={waveRef}
            d={wavePath(0, 0)}
            fill="none"
            stroke={HOT}
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="arousal-balance" aria-hidden="true">
        <div className="arousal-meter">
          <span>Erregung · Glutamat</span>
          <span className="arousal-track">
            <span
              ref={excitationRef}
              className="arousal-bar"
              style={{ width: '86%', background: HOT }}
            />
          </span>
        </div>
        <div className="arousal-meter">
          <span>Hemmung · GABA</span>
          <span className="arousal-track">
            <span
              ref={inhibitionRef}
              className="arousal-bar"
              style={{ width: '30%', background: COOL }}
            />
          </span>
        </div>
      </div>

      <p className="arousal-note" aria-live="polite">
        {target === 0
          ? 'Viele Signale gleichzeitig, die Bremse kommt nicht hinterher.'
          : 'Weniger Signale, gleichmäßiger Rhythmus, mehr Hemmung.'}
        <span className="opacity-70"> Schematische Darstellung, keine Messwerte.</span>
      </p>
    </div>
  );
}
