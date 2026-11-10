import type { SlotProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing status badge with its selected element and tone.
 * @param options - Existing component inputs: {as: Component = 'span', children, className = '', tone = '', ...props}.
 * @returns The rendered React content.
 */
export default function Badge(options: SlotProps & { tone?: string }) {
  const { as: Component = 'span', children, className = '', tone = '', ...props } = options;

  return (
    <Component className={cx('badge', tone, className)} {...props}>
      {children}
    </Component>
  );
}
