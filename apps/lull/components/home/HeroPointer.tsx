'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Mouse parallax and cursor spotlight for the home hero. Writes CSS variables on the section
 * (no React re-render per frame): `--px`/`--py` in [-1, 1] drive the depth layers, and
 * `--spot-x`/`--spot-y` move the spotlight. Mouse only, never touch or pen, and off when the
 * visitor prefers reduced motion.
 */
export function HeroPointer({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  'aria-labelledby'?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let last: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      if (!last) return;
      const rect = section.getBoundingClientRect();
      const x = (last.clientX - rect.left) / rect.width;
      const y = (last.clientY - rect.top) / rect.height;
      section.style.setProperty('--px', (x * 2 - 1).toFixed(3));
      section.style.setProperty('--py', (y * 2 - 1).toFixed(3));
      // The spotlight rests at 50% / 35% of the hero; move it by the offset from there.
      section.style.setProperty('--spot-x', `${((x - 0.5) * rect.width).toFixed(1)}px`);
      section.style.setProperty('--spot-y', `${((y - 0.35) * rect.height).toFixed(1)}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || motion.matches || !finePointer.matches) return;
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      last = null;
      section.style.setProperty('--px', '0');
      section.style.setProperty('--py', '0');
    };

    section.addEventListener('pointermove', onMove);
    section.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      section.removeEventListener('pointermove', onMove);
      section.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <section ref={ref} className={className} {...rest}>
      {children}
    </section>
  );
}
