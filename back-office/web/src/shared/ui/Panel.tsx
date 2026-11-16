import type { SlotProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing panel heading, optional hint and workflow content.
 * @param options - Existing component inputs: {as: Component = 'div', children, className = '', hint, title, ...props}.
 * @returns The rendered React content.
 */
export default function Panel(
  options: SlotProps & { hint?: import('react').ReactNode; title?: import('react').ReactNode },
) {
  const { as: Component = 'div', children, className = '', hint, title, ...props } = options;

  return (
    <Component className={cx('panel', className)} {...props}>
      {title && <h2>{title}</h2>}
      {hint && <p className="hint">{hint}</p>}
      {children}
    </Component>
  );
}
