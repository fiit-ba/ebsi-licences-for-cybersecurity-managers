// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing labeled checkbox and its native input behavior.
 * @param options - Existing component inputs: {children, className = '', id, ...props}.
 * @returns The rendered React content.
 */
export default function Checkbox(options: import('react').InputHTMLAttributes<HTMLInputElement>) {
  const { children, className = '', id, ...props } = options;

  return (
    <label className={cx('check', className)}>
      <input id={id} type="checkbox" {...props} />
      {children}
    </label>
  );
}
