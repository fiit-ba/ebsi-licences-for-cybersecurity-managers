// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing grouped form actions.
 * @param options - Existing component inputs: {children, className = ''}.
 * @returns The rendered React content.
 */
export default function FormActions(options: import('react').HTMLAttributes<HTMLDivElement>) {
  const { children, className = '' } = options;

  return <div className={cx('row', className)}>{children}</div>;
}
