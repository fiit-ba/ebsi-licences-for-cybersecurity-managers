// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).
/**
 * Why a status changes (design decisions D22): the categories each action may
 * give, as back-office/server/lifecycle/proposals.ts validates them, and their names.
 *
 * The category and the note stay in the back-office. What goes on chain with
 * the proposal is their salted commitment, so the ledger shows that a reason
 * was fixed when the proposal was opened, and nothing about which.
 */

import { t } from './i18n/index.ts';

/** The reasons each action may give, most likely first. */
export const REASONS_FOR: Record<string, string[]> = {
  suspend: [
    'key_compromise',
    'under_investigation',
    'holder_request',
    'conditions_not_met',
    'supervisory_decision',
    'issued_in_error',
    'other',
  ],
  revoke: [
    'conditions_not_met',
    'supervisory_decision',
    'holder_request',
    'key_compromise',
    'issued_in_error',
    'superseded',
    'other',
  ],
  reinstate: ['none', 'resolved', 'issued_in_error', 'other'],
};

/** An emergency suspension (component 10.6) gives a suspension's reasons. */
REASONS_FOR.emergency = REASONS_FOR.suspend;

/** The longest note the back-office keeps. */
export const REASON_NOTE_MAX = 500;

/**
 * A reason's name, or the code itself for one this console does not know.
 * @param code - Existing role, language or refusal code selected by the caller.
 * @returns The localized status reason or its original unknown code.
 */
export function reasonLabel(code) {
  return (
    {
      none: t('bez uvedenia dôvodu'),
      key_compromise: t('kompromitácia kľúča alebo peňaženky držiteľa'),
      holder_request: t('na žiadosť držiteľa'),
      issued_in_error: t('chyba pri vydaní'),
      superseded: t('nahradený novým certifikátom'),
      conditions_not_met: t('držiteľ prestal spĺňať podmienky'),
      supervisory_decision: t('rozhodnutie orgánu dohľadu'),
      under_investigation: t('prebieha prešetrovanie'),
      resolved: t('dôvod pozastavenia pominul'),
      // Given by the back-office when a TI's accreditation is revoked (D24).
      issuer_revoked: t('akreditácia TI, ktorý ho vydal, bola odňatá'),
      other: t('iný dôvod'),
    }[code] ?? code
  );
}
