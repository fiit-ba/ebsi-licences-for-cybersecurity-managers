// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing compact definition-list layout.
 * @param options - Existing component inputs: {children, className = '', ...props}.
 * @returns The rendered React content.
 */
export default function KeyValue(options: import('react').HTMLAttributes<HTMLDListElement>) {
  const { children, className = '', ...props } = options;

  return (
    <dl className={cx('kv', className)} {...props}>
      {children}
    </dl>
  );
}
