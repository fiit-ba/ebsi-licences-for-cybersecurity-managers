// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing grouped checkbox layout.
 * @param options - Existing component inputs: {children, className = '', ...props}.
 * @returns The rendered React content.
 */
export default function CheckboxGroup(options: import('react').HTMLAttributes<HTMLDivElement>) {
  const { children, className = '', ...props } = options;

  return (
    <div className={cx('checks', className)} {...props}>
      {children}
    </div>
  );
}
