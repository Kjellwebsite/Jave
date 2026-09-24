import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6 sm:p-8',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  padding?: CardPadding;
  /** Section element for landmarks; defaults to div. */
  as?: 'div' | 'section' | 'article' | 'aside';
  /** Raised surface with the machined top-edge highlight. */
  raised?: boolean;
}

export function Card({
  padding = 'md',
  as: Element = 'div',
  raised = true,
  className,
  ...rest
}: CardProps) {
  return (
    <Element
      className={cx(
        'relative rounded-lg border border-line bg-surface',
        raised && 'machined',
        PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Heading level for the title. */
  level?: 2 | 3 | 4;
}

export function CardHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  level = 2,
}: CardHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="type-eyebrow text-fg-subtle">{eyebrow}</p> : null}
        <Heading className="type-heading text-fg">{title}</Heading>
        {description ? <p className="text-small text-fg-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface PanelProps extends Omit<CardProps, 'title'> {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3 | 4;
  /** Remove body padding (for tables and lists that run edge to edge). */
  flush?: boolean;
  children?: ReactNode;
}

/** A titled card: header strip separated from the body by a hairline. */
export function Panel({
  title,
  eyebrow,
  description,
  actions,
  level,
  flush = false,
  children,
  className,
  as = 'section',
  ...rest
}: PanelProps) {
  return (
    <Card as={as} padding="none" className={cx('flex flex-col', className)} {...rest}>
      <CardHeader
        title={title}
        eyebrow={eyebrow}
        description={description}
        actions={actions}
        level={level}
        className="border-b border-line-subtle px-5 py-4"
      />
      <div className={cx('min-w-0 flex-1', !flush && 'p-5')}>{children}</div>
    </Card>
  );
}
