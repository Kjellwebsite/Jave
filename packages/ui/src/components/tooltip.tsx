'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

const TOOLTIP_DELAY_MS = 300;

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Supplementary hint only — never the sole carrier of essential information. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-90 max-w-64 rounded-md border border-line-strong bg-surface-overlay px-2.5 py-1.5 text-small text-fg shadow-md data-[state=delayed-open]:animate-fade-in"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
