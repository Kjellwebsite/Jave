import type { Specimen, SpecimensContent } from '../../items/generators/specimens';
import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';

const TONES = ['#f1f2f4', '#c9cdd2', '#8d939a', '#4a4f55'];
const INK = '#181a1d';

function Organism({ s }: { s: Specimen }) {
  const fill = TONES[s.tone];
  const parts: React.ReactNode[] = [];
  if (s.symmetry === 'bilateral') {
    const segH = 64 / s.segments;
    const top = 22;
    for (let i = 0; i < s.segments; i++) {
      const cy = top + segH * (i + 0.5);
      parts.push(<ellipse key={`s${i}`} cx="50" cy={cy} rx={14 - Math.abs(i - (s.segments - 1) / 2) * 1.5} ry={segH / 2 - 0.5} fill={fill} stroke={INK} strokeWidth="1.2" />);
      if (s.marking === 'spots') parts.push(<circle key={`m${i}`} cx="50" cy={cy} r="2" fill={INK} />);
      if (s.marking === 'stripes') parts.push(<line key={`m${i}`} x1="40" y1={cy} x2="60" y2={cy} stroke={INK} strokeWidth="1.2" />);
      if (s.marking === 'rings') parts.push(<ellipse key={`m${i}`} cx="50" cy={cy} rx="6" ry={Math.max(1.5, segH / 2 - 4)} fill="none" stroke={INK} strokeWidth="0.9" />);
    }
    for (let i = 0; i < s.limbPairs; i++) {
      const y = top + 6 + ((64 - 12) * (i + 0.5)) / s.limbPairs;
      parts.push(<line key={`l${i}a`} x1="38" y1={y} x2="22" y2={y + 5} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />);
      parts.push(<line key={`l${i}b`} x1="62" y1={y} x2="78" y2={y + 5} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />);
    }
  } else {
    for (let i = s.segments; i >= 1; i--) {
      parts.push(<circle key={`s${i}`} cx="50" cy="55" r={6 + i * 5} fill={i === s.segments ? fill : 'none'} stroke={INK} strokeWidth="1.1" />);
    }
    const arms = s.limbPairs * 2;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const r0 = 6 + s.segments * 5;
      parts.push(<line key={`a${i}`} x1={50 + Math.cos(a) * r0} y1={55 + Math.sin(a) * r0} x2={50 + Math.cos(a) * (r0 + 9)} y2={55 + Math.sin(a) * (r0 + 9)} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />);
    }
    if (s.marking === 'spots') [0, 1, 2].forEach((k) => parts.push(<circle key={`m${k}`} cx={44 + k * 6} cy="55" r="1.8" fill={INK} />));
    if (s.marking === 'stripes') parts.push(<line key="m" x1="42" y1="55" x2="58" y2="55" stroke={INK} strokeWidth="1.2" />);
    if (s.marking === 'rings') parts.push(<circle key="m" cx="50" cy="55" r="3.5" fill="none" stroke={INK} strokeWidth="1" />);
  }
  const headY = s.symmetry === 'bilateral' ? 22 : 55 - (6 + s.segments * 5);
  if (s.antennae !== 'none') {
    const len = s.antennae === 'short' ? 8 : 15;
    parts.push(<line key="a1" x1="46" y1={headY} x2={40} y2={headY - len} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />);
    parts.push(<line key="a2" x1="54" y1={headY} x2={60} y2={headY - len} stroke={INK} strokeWidth="1.2" strokeLinecap="round" />);
    if (s.antennae === 'forked') {
      parts.push(<line key="f1" x1="40" y1={headY - len} x2="36" y2={headY - len - 5} stroke={INK} strokeWidth="1.1" strokeLinecap="round" />);
      parts.push(<line key="f2" x1="40" y1={headY - len} x2="43" y2={headY - len - 6} stroke={INK} strokeWidth="1.1" strokeLinecap="round" />);
      parts.push(<line key="f3" x1="60" y1={headY - len} x2="64" y2={headY - len - 5} stroke={INK} strokeWidth="1.1" strokeLinecap="round" />);
      parts.push(<line key="f4" x1="60" y1={headY - len} x2="57" y2={headY - len - 6} stroke={INK} strokeWidth="1.1" strokeLinecap="round" />);
    }
  }
  return (
    <svg viewBox="0 0 100 100" className="organism" aria-hidden="true">
      {parts}
    </svg>
  );
}

const describe = (s: Specimen) => `${s.symmetry}, ${s.segments} segments, ${s.limbPairs} limb pairs, ${s.marking} marking, ${s.antennae} antennae, tone ${s.tone + 1}`;

export default function SpecimensItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<SpecimensContent>) {
  return (
    <div className="task">
      <p className="task-prompt">These specimens share a hidden pattern. One breaks it. Which?</p>
      <ChoiceGrid
        className="specimen-grid"
        optionClassName="specimen-option"
        columns={3}
        ariaLabel="Nine specimens"
        options={item.content.specimens.map((s, i) => (
          <span key={i} className="paper specimen-card" aria-label={describe(s)}>
            <Organism s={s} />
          </span>
        ))}
        disabled={disabled}
        revealKey={reveal ? (item.key as number) : undefined}
        onSubmit={(index) => onAnswer({ kind: 'choice', index })}
      />
    </div>
  );
}
