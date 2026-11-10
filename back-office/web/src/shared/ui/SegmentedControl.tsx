import type { SegmentedControlProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing controlled segmented selection.
 * @param properties - Selection labels, available values and the current value/change callback.
 * @returns The rendered React content.
 */
export default function SegmentedControl(properties: SegmentedControlProps) {
  const { ariaLabel, className = '', onChange, options, value } = properties;

  return (
    <div className={cx('seg', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
