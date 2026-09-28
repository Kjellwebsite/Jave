'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx, IconButton, Input } from '@jave/ui';

const COPIED_FEEDBACK_MS = 2_000;

export interface CopyFieldProps {
  value: string;
  /** Accessible name of the field, e.g. "Signing secret". */
  label: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Read-only value with a copy button. Falls back to selecting the text when
 * the clipboard API is unavailable (insecure origin, denied permission).
 */
export function CopyField({ value, label, className, 'data-testid': testId }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement) input.select();
    }
  }

  return (
    <div className={cx('flex min-w-0 items-center gap-2', className)}>
      <Input
        id={inputId}
        readOnly
        value={value}
        aria-label={label}
        mono
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        data-testid={testId}
      />
      <IconButton
        icon={copied ? Check : Copy}
        label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        variant="secondary"
        onClick={() => void copy()}
      />
      <span role="status" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}
