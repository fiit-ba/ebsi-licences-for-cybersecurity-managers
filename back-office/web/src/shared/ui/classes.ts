// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

/**
 * Join the existing truthy class-name fragments in their supplied order.
 * @param items - Class-name fragments in their existing order.
 * @returns The space-separated class-name string.
 */
export function cx(...items) {
  return items.filter(Boolean).join(' ');
}
