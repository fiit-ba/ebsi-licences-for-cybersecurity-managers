// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).
/**
 * Why an organization's accreditation is revoked (design decisions D24), as
 * back-office/server/accreditation/invitations.ts validates it. `other` needs a note.
 */

import { t } from './i18n/index.ts';

/** The reasons, most likely first. */
export const ORGANIZATION_REVOCATION_REASONS = [
  'conditions_not_met',
  'breach',
  'supervisory_decision',
  'organization_request',
  'dissolved',
  'other',
];

/** The longest note the back-office keeps. */
export const REVOCATION_NOTE_MAX = 500;

/**
 * A reason's name, or the code itself for one this console does not know.
 * @param code - Existing role, language or refusal code selected by the caller.
 * @returns The localized organization-revocation reason or its original unknown code.
 */
export function revocationReasonLabel(code) {
  return (
    {
      conditions_not_met: t('organizácia prestala spĺňať podmienky akreditácie'),
      breach: t('porušenie povinností akreditovanej organizácie'),
      supervisory_decision: t('rozhodnutie orgánu dohľadu'),
      organization_request: t('na žiadosť organizácie'),
      dissolved: t('zánik organizácie'),
      other: t('iný dôvod'),
    }[code] ?? code
  );
}
