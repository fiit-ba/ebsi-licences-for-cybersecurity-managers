import type { SlotProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing informational, warning or refusal notice.
 * @param options - Existing component inputs: {as: Component = 'div', children, className = '', tone = 'info', ...props}.
 * @returns The rendered React content.
 */
export default function Notice(options: SlotProps & { tone?: string }) {
  const { as: Component = 'div', children, className = '', tone = 'info', ...props } = options;

  return (
    <Component className={cx('notice', tone, className)} {...props}>
      {children}
    </Component>
  );
}
