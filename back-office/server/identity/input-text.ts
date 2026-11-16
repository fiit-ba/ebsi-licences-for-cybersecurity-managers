/**
 * Strip the surrounding whitespace accepted by the identity input contract.
 * @param value - String field that permits surrounding whitespace trimming.
 * @returns The string with surrounding Unicode whitespace and separator controls removed; a BOM is retained.
 * @remarks Login passwords disable trimming. Recovery token/password fields and
 * usernames enable it. JavaScript trim has a different Unicode character set.
 */
export function trimIdentityField(value: string): string {
  return value.replace(
    /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
    '',
  );
}
