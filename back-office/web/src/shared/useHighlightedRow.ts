// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The row a link points at with `?<param>=<id>` - from what awaited the user
 * at sign-in - scrolled into view once the rows are there. Rows carry the id
 * `<param>-<id>`.
 * @param param - Existing query parameter identifying a highlighted row.
 * @param ready - Whether the requested rows are available to scroll into view.
 * @returns The requested row identifier, or an empty string without that query parameter.
 */
export function useHighlightedRow(param, ready) {
  const [params] = useSearchParams();
  const wanted = params.get(param) || '';
  useEffect(() => {
    if (!wanted || !ready) return;
    document
      .getElementById(`${param}-${wanted}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [param, wanted, ready]);
  return wanted;
}
