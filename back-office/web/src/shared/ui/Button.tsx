import type { ButtonProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing console button variants while retaining native button attributes.
 * @param options - Existing component inputs: { as: Component = 'button', block = false, children, className = '', size = 'md', variant = 'primary', ...props }.
 * @returns The rendered React content.
 */
export default function Button(options: ButtonProps) {
  const {
    as: Component = 'button',
    block = false,
    children,
    className = '',
    size = 'md',
    variant = 'primary',
    ...props
  } = options;

  const variantClass = variant === 'primary' ? '' : variant;
  const sizeClass = size === 'md' ? '' : size;
  const buttonProps = Component === 'button' && !props.type ? { type: 'button' as const } : {};
  return (
    <Component
      className={cx('btn', variantClass, sizeClass, block && 'block', className)}
      {...buttonProps}
      {...props}
    >
      {children}
    </Component>
  );
}
