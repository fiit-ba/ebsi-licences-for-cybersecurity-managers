// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { cx } from './classes.ts';

/**
 * Render the existing labeled registry summary value.
 * @param options - Existing component inputs: {label, tone = '', value}.
 * @returns The rendered React content.
 */
export default function StatCard(options: {
  label: import('react').ReactNode;
  tone?: string;
  value: import('react').ReactNode;
}) {
  const { label, tone = '', value } = options;

  return (
    <div className={cx('stat', tone)}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
