import type { TableProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing table with its optional horizontal scrolling wrapper.
 * @param options - Existing component inputs: { children, className = '', scroll = true, spaced = false, wrapperClassName = '', ...props }.
 * @returns The rendered React content.
 */
export default function Table(options: TableProps) {
  const {
    children,
    className = '',
    scroll = true,
    spaced = false,
    wrapperClassName = '',
    ...props
  } = options;

  const table = (
    <table className={cx(className, !scroll && spaced && 'table-spaced')} {...props}>
      {children}
    </table>
  );
  if (!scroll) return table;
  return <div className={cx('scroll-x', spaced && 'table-spaced', wrapperClassName)}>{table}</div>;
}
