// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

/**
 * Normalize an application path without changing its registered route identity.
 * @param pathname - Requested application path.
 * @returns The existing normalized route path.
 */
export function normalizeRoutePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Compose a route destination while retaining the current query string.
 * @param pathname - Requested application path.
 * @param search - Existing navigation query string.
 * @returns The route URL including the supplied query string.
 */
export function routeLocation(pathname, search = '') {
  return { pathname, search };
}

/**
 * Replace one query parameter while preserving the remaining navigation context.
 * @param search - Existing navigation query string.
 * @param key - Query parameter or operation identifier.
 * @param value - Current input or state value.
 * @returns The updated query string.
 */
export function replaceSearchParam(search, key, value) {
  const params = new URLSearchParams(search);
  if (!params.has(key)) return search;
  params.set(key, value);
  const next = params.toString();
  return next ? `?${next}` : '';
}
