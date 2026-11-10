import type { TextInputProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing native input with validation and monospace appearance options.
 * @param options - Existing component inputs: {className = '', invalid = false, mono = false, ...props}.
 * @returns The rendered React content.
 */
export default function TextInput(options: TextInputProps) {
  const { className = '', invalid = false, mono = false, ...props } = options;

  const input = (
    <input
      className={cx(
        mono && 'mono',
        invalid && 'field-invalid',
        props.type === 'date' && props.placeholder && !props.value && 'date-input-empty',
        className,
      )}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      {...props}
    />
  );

  if (props.type !== 'date' || !props.placeholder || props.value) return input;

  return (
    <span className="date-input-wrap">
      <span className="date-input-placeholder" aria-hidden="true">
        {props.placeholder}
      </span>
      {input}
    </span>
  );
}
