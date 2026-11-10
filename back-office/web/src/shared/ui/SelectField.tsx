import type { SelectFieldProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';
import Field from './Field.tsx';

/**
 * Render the existing labeled select with its native behavior and validation state.
 * @param options - Existing component inputs: { children, className = '', error, fieldClassName = '', hint, id, invalid = false, label, ...props }.
 * @returns The rendered React content.
 */
export default function SelectField(options: SelectFieldProps) {
  const {
    children,
    className = '',
    error,
    fieldClassName = '',
    hint,
    id,
    invalid = false,
    label,
    ...props
  } = options;

  const hasError = Boolean(error);
  return (
    <Field className={fieldClassName} error={error} hint={hint} id={id} label={label}>
      <select
        id={id}
        className={cx((invalid || hasError) && 'field-invalid', className)}
        aria-invalid={invalid || hasError || props['aria-invalid'] || undefined}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}
