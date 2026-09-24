import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Tighter rows for data-heavy views (audit log, rosters). */
  dense?: boolean;
  /** Accessible caption; visually hidden unless `showCaption`. */
  caption?: string;
  showCaption?: boolean;
  /** Classes for the scroll container. */
  containerClassName?: string;
}

/** Tables scroll horizontally inside their container so pages never do. */
export function Table({
  dense = false,
  caption,
  showCaption = false,
  className,
  containerClassName,
  children,
  ...rest
}: TableProps) {
  return (
    <div className={cx('w-full overflow-x-auto', containerClassName)}>
      <table
        data-density={dense ? 'dense' : 'default'}
        className={cx('group/table w-full border-collapse text-left text-body', className)}
        {...rest}
      >
        {caption ? (
          <caption
            className={cx(
              showCaption ? 'type-eyebrow px-4 pb-2 text-left text-fg-subtle' : 'sr-only',
            )}
          >
            {caption}
          </caption>
        ) : null}
        {children}
      </table>
    </div>
  );
}

export function TableHead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx('border-b border-line', className)} {...rest} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx(
        'border-b border-line-subtle transition-colors last:border-0 hover:bg-surface-raised/60',
        className,
      )}
      {...rest}
    />
  );
}

export function TableHeaderCell({
  className,
  scope = 'col',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cx(
        'type-eyebrow whitespace-nowrap px-4 py-2.5 font-medium text-fg-subtle first:pl-5 last:pr-5',
        className,
      )}
      {...rest}
    />
  );
}

export function TableCell({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cx(
        'px-4 py-3 align-middle text-fg-muted first:pl-5 last:pr-5 group-data-[density=dense]/table:py-2',
        className,
      )}
      {...rest}
    />
  );
}

export interface TableEmptyRowProps {
  colSpan: number;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function TableEmptyRow({ colSpan, title, description, action }: TableEmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center">
        <p className="type-eyebrow text-fg-muted">{title}</p>
        {description ? (
          <p className="mx-auto mt-2 max-w-sm text-small text-fg-subtle">{description}</p>
        ) : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </td>
    </tr>
  );
}
