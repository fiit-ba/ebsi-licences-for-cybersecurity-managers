// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { proposalStateLabel } from '../../../blockchain/governance.ts';
import Badge from '../../../shared/ui/Badge.tsx';
import Table from '../../../shared/ui/Table.tsx';
import { t } from '../../../shared/i18n/index.ts';
import {
  DAY,
  kindLabel,
  policyText,
  roleOfSigner,
  round,
  same,
  short,
  vetoRefusal,
  when,
} from '../governanceFormat.ts';
import Tally from '../components/Tally.tsx';
import VoteButtons from '../components/VoteButtons.tsx';
import { verdictNotice } from './ruleChange.ts';

/**
 * Render ledger rule changes and the signer actions permitted by the existing policies.
 * @param options - Existing component inputs: { byBackend, canAct, changes, cosign, info, isSigner, label, n, busy, voter, voterRole, onVote, }.
 * @returns The rendered React content.
 */
export default function AdminProposalTable(options) {
  const {
    byBackend,
    canAct,
    changes,
    cosign,
    info,
    isSigner,
    label,
    n,
    busy,
    voter,
    voterRole,
    onVote,
  } = options;

  if (changes.length === 0) return null;

  /** A key by its short address, and its role while it has one. */
  const keyText = (address) => {
    const r = roleOfSigner(info, address);
    return r ? `${short(address)} · ${r}` : short(address);
  };

  /**
   * Describe the selected signer, policy or proposal-lifetime change for the operator.
   * @param c - Existing mapped rule-change fields.
   * @returns The existing operator-facing rule-change description.
   */
  function describe(c) {
    switch (c.action) {
      case 'set_policy':
        return `${kindLabel(c.kind)}: ${policyText(
          {
            threshold: c.threshold,
            requiredRoles: c.required_roles,
            vetoRoles: c.veto_roles,
            timelock: c.timelock,
          },
          n,
        )}`;
      case 'add_signer':
        return t('pridať kľúč {0} pre rolu {1}', [short(c.subject), c.role]);
      case 'remove_signer':
        return t('odobrať kľúč {0}', [keyText(c.subject)]);
      case 'replace_signer':
        return t('vymeniť kľúč {0} za {1}', [keyText(c.subject), keyText(c.replacement)]);
      case 'set_proposal_ttl':
        return t('platnosť návrhov {0} dní', [round(c.ttl / DAY)]);
      default:
        return c.action;
    }
  }

  return (
    <Table spaced>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('Zmena')}</th>
          <th>{t('Stav')}</th>
          <th>{t('Podpisy')}</th>
          <th>{t('Vykonateľné')}</th>
          <th>{t('Hlasovanie')}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((p) => {
          const answer = cosign[p.id];
          const signBlocked =
            byBackend && answer && !answer.allowed ? verdictNotice(answer, voterRole).text : '';
          // The key a change removes or replaces cannot veto it (component
          // 10.9), and only the roles the admin policy names may veto (D21).
          const vetoBlocked =
            ['remove_signer', 'replace_signer'].includes(p.change.action) &&
            same(p.change.subject, voter)
              ? t('Kľúč nemôže vetovať vlastné odobratie ani výmenu.')
              : vetoRefusal(info.policies.admin, voterRole, p, voter);
          return (
            <tr key={p.id}>
              <td className="mono">{p.id}</td>
              <td>{describe(p.change)}</td>
              <td>
                <Badge tone={p.state} title={p.state}>
                  {proposalStateLabel(p.state)}
                </Badge>
              </td>
              <td className="cell-min-md">
                <Tally p={p} policy={info.policies.admin} info={info} />
              </td>
              <td className="mono">{p.executableAt ? when(p.executableAt) : '—'}</td>
              <td>
                <VoteButtons
                  p={p}
                  voter={voter}
                  canAct={canAct}
                  isSigner={isSigner}
                  busy={busy}
                  onVote={onVote}
                  signBlocked={signBlocked}
                  vetoBlocked={vetoBlocked}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
