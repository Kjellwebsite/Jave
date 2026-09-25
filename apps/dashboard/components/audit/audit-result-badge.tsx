import { StatusBadge } from '@jave/ui';
import type { AuditResult } from '@jave/core';

const RESULT_TONE = {
  success: { tone: 'success', label: 'SUCCESS' },
  denied: { tone: 'warning', label: 'DENIED' },
  failure: { tone: 'danger', label: 'FAILURE' },
} as const;

/** SUCCESS is the norm and stays quiet; DENIED and FAILURE stand out. */
export function AuditResultBadge({ result }: { result: AuditResult }) {
  const { tone, label } = RESULT_TONE[result];
  return <StatusBadge tone={tone} label={label} quiet={result === 'success'} />;
}
