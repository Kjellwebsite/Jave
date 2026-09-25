import { animate, motion, useReducedMotion } from 'motion/react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from 'react';

export function Label({ children, className = '', as: Tag = 'span' }: { children: ReactNode; className?: string; as?: 'span' | 'p' | 'div' | 'h2' | 'h3' }) {
  return <Tag className={`label ${className}`}>{children}</Tag>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  kbd?: string;
};

export function Button({ variant = 'primary', size = 'md', kbd, className = '', children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      <span>{children}</span>
      {kbd ? <Kbd>{kbd}</Kbd> : null}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`rule ${className}`} />;
}

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'strong' | 'outline'; title?: string }) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`wordmark ${compact ? 'is-compact' : ''}`} aria-label="JVLN Intelligence">
      <span className="wordmark-jvln">JVLN</span>
      {!compact && <span className="wordmark-sub">Intelligence</span>}
    </span>
  );
}

/** Crosshair corner marks around a stimulus frame. Purely decorative. */
export function Frame({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={`frame ${className}`}>
      <span className="frame-corner tl" aria-hidden="true" />
      <span className="frame-corner tr" aria-hidden="true" />
      <span className="frame-corner bl" aria-hidden="true" />
      <span className="frame-corner br" aria-hidden="true" />
      {label ? (
        <span className="frame-label mono" aria-hidden="true">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function ProgressLine({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <motion.span className="progress-line-fill" initial={false} animate={{ scaleX: v }} transition={{ type: 'spring', stiffness: 120, damping: 26 }} />
    </div>
  );
}

export function Ring({ value, size = 44, stroke = 2, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--text)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: 'spring', stiffness: 90, damping: 24 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children ? <span className="ring-inner">{children}</span> : null}
    </span>
  );
}

/** Number that interpolates to its value once, when mounted or changed. */
export function Ticker({ value, format }: { value: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !Number.isFinite(value)) {
      el.textContent = format(value);
      return;
    }
    const controls = animate(0, value, { duration: 1.1, ease: [0.2, 0.7, 0.1, 1], onUpdate: (v) => (el.textContent = format(v)) });
    return () => controls.stop();
  }, [value, format, reduce]);
  return <span ref={ref} className="tnum">{format(value)}</span>;
}

export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <Label>{label}</Label>
      <div className="stat-value">{value}</div>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}
