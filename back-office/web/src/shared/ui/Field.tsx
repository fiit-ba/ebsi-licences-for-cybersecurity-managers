import type { FieldProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing field label, help text, control and validation explanation.
 * @param options - Existing component inputs: {children, className = '', error, hint, id, label}.
 * @returns The rendered React content.
 */
export default function Field(options: FieldProps) {
  const { children, className = '', error, hint, id, label } = options;

  return (
    <div className={cx('form-field', className)}>
      {label &&
        (id ? <label htmlFor={id}>{label}</label> : <span className="field-label">{label}</span>)}
      {children}
      {hint && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
