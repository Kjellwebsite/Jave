'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ElementType } from 'react';

type Phase = 'static' | 'hidden' | 'shown';

type RevealProps<T extends ElementType> = {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, 'as'>;

/**
 * Scroll reveal. Server HTML (and any visit without JavaScript) keeps the content visible;
 * only after hydration are sections below the fold hidden until they scroll into view.
 * Sections already on screen play their entrance right away. `rv-show` also starts
 * the section's own animations (rolling digits, drawn check marks).
 */
export function Reveal<T extends ElementType = 'section'>({
  as,
  className,
  ...rest
}: RevealProps<T>) {
  const Tag: ElementType = as ?? 'section';
  const ref = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>('static');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const rect = element.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight * 0.9 && rect.bottom > 0;
    setPhase(onScreen ? 'shown' : 'hidden');
    if (onScreen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setPhase('shown');
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const phaseClass = phase === 'hidden' ? 'rv rv-hide' : phase === 'shown' ? 'rv rv-show' : 'rv';
  return <Tag ref={ref} className={[phaseClass, className].filter(Boolean).join(' ')} {...rest} />;
}
