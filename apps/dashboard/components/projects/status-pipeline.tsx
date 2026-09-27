import { Badge, StatusBadge, cx } from '@jave/ui';
import {
  PIPELINE_STAGES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONE,
  PROJECT_VISIBILITY_LABELS,
  pipelineState,
  type ProjectStatusKey,
  type ProjectVisibilityKey,
} from '@/lib/project-view';

/** Status as a badge: SHIPPED stands out, archived projects read quiet. */
export function ProjectStatusBadge({ status }: { status: ProjectStatusKey }) {
  return (
    <StatusBadge
      tone={PROJECT_STATUS_TONE[status]}
      quiet={status === 'archived'}
      label={PROJECT_STATUS_LABELS[status].toUpperCase()}
    />
  );
}

export function VisibilityBadge({ visibility }: { visibility: ProjectVisibilityKey }) {
  return <Badge>{PROJECT_VISIBILITY_LABELS[visibility]}</Badge>;
}

/** Five hairline segments, filled up to the current stage. Decorative; the badge carries the state. */
export function PipelineMeter({ status }: { status: ProjectStatusKey }) {
  return (
    <span aria-hidden className="grid grid-cols-5 gap-1">
      {PIPELINE_STAGES.map((stage) => {
        const state = pipelineState(status, stage);
        return (
          <span
            key={stage}
            className={cx(
              'h-0.5 rounded-full',
              state === 'ahead' && 'bg-line-strong',
              state === 'passed' && 'bg-fg-subtle',
              state === 'current' && (status === 'shipped' ? 'bg-success' : 'bg-fg'),
            )}
          />
        );
      })}
    </span>
  );
}

/** IDEA → PLANNING → BUILDING → TESTING → SHIPPED, with the current stage marked. */
export function StatusPipeline({ status }: { status: ProjectStatusKey }) {
  return (
    <ol
      aria-label="Project lifecycle"
      className="grid grid-cols-5 overflow-hidden rounded-lg border border-line bg-surface"
    >
      {PIPELINE_STAGES.map((stage, index) => {
        const state = pipelineState(status, stage);
        return (
          <li
            key={stage}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cx(
              'relative flex min-w-0 flex-col gap-2 px-2 py-3 sm:px-4 sm:py-4',
              index > 0 && 'border-l border-line-subtle',
              state === 'current' && 'bg-surface-raised',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'absolute inset-x-0 top-0 h-0.5',
                state === 'passed' && 'bg-fg-subtle',
                state === 'current' && (stage === 'shipped' ? 'bg-success' : 'bg-fg'),
              )}
            />
            <span className="type-data text-[11px] text-fg-subtle">0{index + 1}</span>
            <span
              className={cx(
                'type-eyebrow truncate text-[10px] sm:text-[11px]',
                state === 'current'
                  ? 'text-fg'
                  : state === 'passed'
                    ? 'text-fg-muted'
                    : 'text-fg-subtle',
              )}
            >
              {PROJECT_STATUS_LABELS[stage]}
            </span>
            {state === 'current' ? <span className="sr-only">(current stage)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
