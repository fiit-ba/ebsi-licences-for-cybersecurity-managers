import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as english from '@zxcvbn-ts/language-en';

export const minimumPasswordCharacters = 15;
export const maximumPasswordCharacters = 128;
const minimumStrengthScore = 3;

const strength = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...english.dictionary },
  graphs: common.adjacencyGraphs,
  // The estimator counts UTF-16 units; this covers every accepted 128-code-point password.
  maxLength: maximumPasswordCharacters * 2,
});

/** Account attributes used only for this password's local guessability estimate. */
export interface PasswordIdentity {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

/** Password-policy refusals exposed by account creation and password-change operations. */
export type PasswordPolicyCode = 'password_too_short' | 'password_too_long' | 'password_too_weak';

/** Public explanations that never include the submitted password or matched account data. */
export const passwordPolicyMessages: Record<PasswordPolicyCode, string> = {
  password_too_short: 'Use at least 15 characters.',
  password_too_long: 'Use at most 128 characters.',
  password_too_weak: 'Choose a less predictable password or a longer phrase with unrelated words.',
};

/**
 * Build bounded per-call personal dictionary inputs without modifying the shared estimator.
 * @param identity - Validated account attributes; absent or short fragments are ignored.
 * @returns Distinct attributes and word components, limited to 24 entries of at most 256 UTF-16 units.
 * @remarks These values never enter the persistent dictionary, logs, responses or network requests.
 */
function personalInputs(identity: PasswordIdentity): string[] {
  const inputs = new Set<string>();
  for (const value of Object.values(identity)) {
    if (!value) continue;
    const bounded = value.slice(0, 256);
    for (const part of [bounded, ...bounded.split(/[^\p{L}\p{N}_]+/u)]) {
      if (Array.from(part).length >= 3) inputs.add(part);
      if (inputs.size === 24) return [...inputs];
    }
  }
  return [...inputs];
}

/**
 * Require 15–128 Unicode code points and a local zxcvbn strength score of at least three.
 * @param password - Submitted password after the endpoint's input handling; no normalization occurs here.
 * @param identity - Current account details supplied as ephemeral dictionary inputs.
 * @returns One public refusal code, or an empty array for an accepted candidate.
 * @remarks Length is checked before expensive matching, without truncation. No character-class
 * quota or numeric-only ban applies. Assignment and login use the same policy; stored scrypt
 * hashes remain unchanged. Strength estimates are heuristic, not breach checks.
 */
export function passwordPolicyCodes(
  password: string,
  identity: PasswordIdentity,
): PasswordPolicyCode[] {
  let length = 0;
  for (const _character of password) {
    if (++length > maximumPasswordCharacters) return ['password_too_long'];
  }
  if (length < minimumPasswordCharacters) return ['password_too_short'];

  return strength.check(password, personalInputs(identity)).score < minimumStrengthScore
    ? ['password_too_weak']
    : [];
}
