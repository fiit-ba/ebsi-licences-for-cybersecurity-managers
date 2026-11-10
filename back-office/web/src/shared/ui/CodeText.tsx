import type { SlotProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing monospaced value with optional line wrapping.
 * @param options - Existing component inputs: {as: Component = 'div', children, className = '', wrap = false, ...props}.
 * @returns The rendered React content.
 */
export default function CodeText(options: SlotProps & { wrap?: boolean }) {
  const { as: Component = 'div', children, className = '', wrap = false, ...props } = options;

  return (
    <Component className={cx('mono', wrap && 'wrap-anywhere', className)} {...props}>
      {children}
    </Component>
  );
}
