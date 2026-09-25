import { type ReactNode, useEffect } from 'react';
import { Button, Label } from '../ui';

/** Screen between phases of a performance task. */
export function Gate({ title, children, action = 'Start', onGo, label }: { title: string; children?: ReactNode; action?: string; onGo(): void; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onGo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGo]);
  return (
    <div className="gate">
      {label ? <Label>{label}</Label> : null}
      <h2>{title}</h2>
      {children ? <div className="gate-body">{children}</div> : null}
      <Button size="lg" onClick={onGo} kbd="↵" autoFocus>
        {action}
      </Button>
    </div>
  );
}

/** Fixed-size stimulus field used by timed tasks. */
export function Field({ children, className = '', onPointerDown }: { children?: ReactNode; className?: string; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <div className={`field paper ${className}`} onPointerDown={onPointerDown}>
      <span className="field-cross" aria-hidden="true" />
      {children}
    </div>
  );
}
