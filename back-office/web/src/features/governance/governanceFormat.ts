// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { formatDateTime, t } from '../../shared/i18n/index.ts';

/**
 * What each role stands for (component 10.2).
 * @param role - Existing signer role identifier.
 * @returns The known role letter or numeric fallback.
 */
export function roleName(role) {
  return {
    A: t('certifikačný orgán · navrhovateľ'),
    B: t('certifikačný orgán · druhý schvaľovateľ'),
    C: t('orgán dohľadu'),
  }[role];
}

/**
 * Resolve an existing status action to its localized label.
 * @param action - Existing lifecycle or rule-change action.
 * @returns The localized action label or its original unknown code.
 */
export function actionLabel(action) {
  return (
    {
      suspend: t('pozastavenie'),
      revoke: t('odňatie'),
      reinstate: t('obnovenie'),
    }[action] ?? action
  );
}

/**
 * The contract's policy kinds: the three status actions and its own rules.
 * @param kind - Existing action, vote or policy kind.
 * @returns The existing policy-kind label.
 */
export function kindLabel(kind) {
  return kind === 'admin' ? t('zmena pravidiel') : actionLabel(kind);
}

// APPROVED: the quorum is reached; the proposal runs once its timelock ends.
export const OPEN = new Set(['PROPOSED', 'APPROVED']);

/**
 * Resolve a completed status vote to its existing localized explanation.
 * @param kind - Existing action, vote or policy kind.
 * @returns The localized status-vote completion message.
 */
export function doneMessage(kind) {
  return {
    sign: t('Podpis je na chaine.'),
    execute: t('Návrh je vykonaný. Back-office teraz zmení stav certifikátu.'),
    cancel: t('Návrh je vetovaný a uzavretý. Certifikát ostáva bez zmeny.'),
    expire: t('Návrh je uvoľnený; certifikát je možné navrhnúť znova.'),
  }[kind];
}

/**
 * The same for a rule change.
 * @param kind - Existing action, vote or policy kind.
 * @returns The localized rule-change completion message.
 */
export function adminDoneMessage(kind) {
  return {
    propose: t('Zmena pravidiel je navrhnutá.'),
    sign: t('Podpis je na chaine.'),
    execute: t('Zmena pravidiel platí.'),
    cancel: t('Zmena pravidiel je vetovaná a uzavretá.'),
  }[kind];
}

/**
 * Where a wallet vote is, so a slow step does not look like a hang.
 * @param stage - Current simulation, confirmation or mining stage.
 * @returns The localized wallet stage or original unknown stage.
 */
export function stageLabel(stage) {
  return (
    {
      simulating: t('overuje sa, či kontrakt hlas prijme…'),
      confirm: t('potvrďte transakciu v peňaženke…'),
      mining: t('transakcia je odoslaná, čaká sa na zápis do bloku…'),
    }[stage] ?? stage
  );
}

/**
 * Compare two nonempty signer addresses case-insensitively.
 * @param a - First address to compare or shorten.
 * @param b - Second address to compare.
 * @returns Whether both nonempty addresses match case-insensitively.
 */
export const same = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
/**
 * Shorten an address using the existing leading and trailing segments.
 * @param a - First address to compare or shorten.
 * @returns The existing shortened address.
 */
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/**
 * Format an epoch-seconds timestamp using the active console locale.
 * @param seconds - Existing epoch-seconds timestamp.
 * @returns The localized date and time for epoch seconds.
 */
export const when = (seconds) => formatDateTime(seconds * 1000);
export const HOUR = 3600;
export const DAY = 86400;
/**
 * Round a displayed timing value to two decimal places.
 * @param value - Current input or state value.
 * @returns The value rounded to two decimal places.
 */
export const round = (value) => Math.round(value * 100) / 100;

/**
 * The role a key holds for the TI shown, as the contract has it: one of the TI's own keys, or a
 * key of a cosigner's DID; undefined for a non-signer.
 * @param info - Current independently read contract configuration.
 * @param address - Key address.
 * @returns The signer role, or undefined for an unknown address.
 */
export const roleOfSigner = (info, address) =>
  info?.signers.find((s) => same(s.address, address))?.role ??
  info?.cosignerKeys?.find((s) => same(s.address, address))?.role;

/**
 * "2 z 3 rolí · vrátane C · veto A, B, C · časový zámok 24 h"
 * @param policy - Current contract quorum, required-role, veto and timelock fields.
 * @param roles - Current role assignments or available organizational roles.
 * @returns The joined quorum, required roles, veto roles and timelock description.
 */
export function policyText(policy, roles) {
  const parts = [t('{0} z {1} rolí', [policy.threshold, roles])];
  if (policy.requiredRoles.length) parts.push(t('vrátane {0}', [policy.requiredRoles.join(', ')]));
  if (policy.vetoRoles) parts.push(t('veto {0}', [policy.vetoRoles.join(', ')]));
  parts.push(
    policy.timelock
      ? t('časový zámok {0} h', [round(policy.timelock / HOUR)])
      : t('bez časového zámku'),
  );
  return parts.join(' · ');
}

/**
 * Why the contract would refuse this voter's veto, or '' (design decisions D21):
 * the policy gives the veto to some roles only, and besides them only the key
 * that opened a proposal may withdraw it. Unknown roles are left to the contract.
 * @param policy - Current contract quorum, required-role, veto and timelock fields.
 * @param voterRole - Role held by the currently selected signer.
 * @param p - Ledger proposal with its current ballot and proposer.
 * @param voter - Currently selected signer address.
 * @returns The existing veto refusal text, or an empty string when not locally blocked.
 */
export function vetoRefusal(policy, voterRole, p, voter) {
  if (!policy?.vetoRoles || !voterRole || same(p.proposer, voter)) return '';
  if (policy.vetoRoles.includes(voterRole)) return '';
  return t(
    'Rola {0} nemá podľa pravidla právo veta; stiahnuť návrh môže len kľúč, ktorý ho otvoril.',
    [voterRole],
  );
}
