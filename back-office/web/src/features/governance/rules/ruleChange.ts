// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { explainVoteError, loosenReason } from '../../../blockchain/governance.ts';
import { t } from '../../../shared/i18n/index.ts';
import { DAY, HOUR, round } from '../governanceFormat.ts';

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The form's fields for a change, from the rules as they are now.
 * @param action - Existing lifecycle or rule-change action.
 * @param info - Current independently read contract configuration.
 * @param kind - Existing action, vote or policy kind.
 * @returns The form fields initialized from the current contract configuration.
 */
export function formFor(action, info, kind = 'revoke') {
  const policy = info.policies[kind];
  return {
    action,
    kind,
    threshold: String(policy.threshold),
    required: policy.requiredRoles,
    veto: policy.vetoRoles,
    timelockHours: String(round(policy.timelock / HOUR)),
    ttlDays: String(round(info.proposalTtl / DAY)),
    subject: '',
    replacement: '',
    signerRole: 'A',
  };
}

/**
 * The change in the form, as the contract and the back-office take it - or why it is not one yet.
 * @param form - Current rule-change editor field values.
 * @returns The existing change payload or a missing-input explanation.
 */
export function changeFrom(form) {
  switch (form.action) {
    case 'set_policy':
      if (!form.threshold || form.timelockHours === '')
        return { missing: t('Doplňte prah a časový zámok.') };
      if (!form.veto.length) return { missing: t('Zvoľte aspoň jednu rolu s právom veta.') };
      return {
        change: {
          action: 'set_policy',
          kind: form.kind,
          threshold: Number(form.threshold),
          required_roles: [...form.required].sort(),
          veto_roles: [...form.veto].sort(),
          timelock: Math.round(Number(form.timelockHours) * HOUR),
        },
      };
    case 'add_signer':
      if (!ADDRESS.test(form.subject.trim())) return { missing: t('Zadajte adresu nového kľúča.') };
      // The back-office reads the new key's role as signer_role
      // (back-office/server/lifecycle/admin-policy.ts); `role` beside the change is the voter's own.
      return {
        change: {
          action: 'add_signer',
          subject: form.subject.trim(),
          signer_role: form.signerRole,
        },
      };
    case 'remove_signer':
      if (!form.subject) return { missing: t('Zvoľte kľúč.') };
      return { change: { action: 'remove_signer', subject: form.subject } };
    case 'replace_signer':
      if (!form.subject) return { missing: t('Zvoľte kľúč, ktorý sa vymení.') };
      if (!ADDRESS.test(form.replacement.trim()))
        return { missing: t('Zadajte adresu nového kľúča.') };
      return {
        change: {
          action: 'replace_signer',
          subject: form.subject,
          replacement: form.replacement.trim(),
        },
      };
    case 'set_proposal_ttl':
      if (!form.ttlDays) return { missing: t('Zadajte platnosť v dňoch.') };
      return {
        change: { action: 'set_proposal_ttl', ttl: Math.round(Number(form.ttlDays) * DAY) },
      };
    default:
      return { missing: '' };
  }
}

/**
 * What the back-office said to a change, as a notice.
 * @param verdict - Existing backend policy-check response.
 * @param voterRole - Role held by the currently selected signer.
 * @returns The server-policy notice, or null while no verdict is available.
 */
export function verdictNotice(verdict, voterRole) {
  if (!verdict) return null;
  if (verdict.error) return { tone: 'err', text: verdict.error };
  const why = (verdict.loosens ?? []).map(loosenReason).join('; ');
  if (verdict.allowed && !verdict.supervisor_first) {
    return { tone: 'ok', text: t('Certifikačný orgán môže túto zmenu navrhnúť sám.') };
  }
  if (verdict.allowed) {
    return voterRole === 'C'
      ? {
          tone: 'info',
          text: t(
            'Zmena uvoľňuje pravidlá ({0}). Ako orgán dohľadu ju môžete otvoriť; certifikačný orgán sa pripojí podpisom po vás.',
            [why],
          ),
        }
      : {
          tone: 'info',
          text: t('Orgán dohľadu už podpísal ({0}), certifikačný orgán sa môže pripojiť.', [why]),
        };
  }
  if (verdict.reason === 'SupervisorFirst') {
    return {
      tone: 'warn',
      text: t(
        'Otvoriť ju môže len orgán dohľadu — {0}. Certifikačný orgán sa pripojí podpisom až po ňom.',
        [why],
      ),
    };
  }
  // Not a refusal so much as nothing to do yet: the form starts from the current rule.
  if (verdict.reason === 'NoChange')
    return { tone: 'info', text: explainVoteError({ reason: 'NoChange' }) };
  return { tone: 'err', text: explainVoteError({ reason: verdict.reason }) };
}
