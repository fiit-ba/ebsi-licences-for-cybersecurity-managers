// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { proposalStateLabel } from '../../../blockchain/governance.ts';
import Badge from '../../../shared/ui/Badge.tsx';
import EmptyState from '../../../shared/ui/EmptyState.tsx';
import Panel from '../../../shared/ui/Panel.tsx';
import Table from '../../../shared/ui/Table.tsx';
import { t } from '../../../shared/i18n/index.ts';
import { actionLabel, vetoRefusal, when } from '../governanceFormat.ts';

const NO_REASON = '0x' + '0'.repeat(64);
import Progress from './Progress.tsx';
import Tally from './Tally.tsx';
import VoteButtons from './VoteButtons.tsx';

/**
 * Render current ledger proposals, tallies and the votes available to the selected signer.
 * @param options - Existing component inputs: {proposals, highlighted, info, voter, voterRole, canAct, isSigner, busy, stage, outcome, onVote}.
 * @returns The rendered React content.
 */
export default function ProposalTable(options) {
  const {
    proposals,
    highlighted,
    info,
    voter,
    voterRole,
    canAct,
    isSigner,
    busy,
    stage,
    outcome,
    onVote,
  } = options;

  return (
    <Panel
      hint={t(
        'Podpisy sa agregujú priamo na chaine, takže každý je samostatne a časovo overiteľný (komponent 10.4). Kvórum počíta roly, nie kľúče; hviezdička označuje rolu, ktorej podpis pravidlo vyžaduje.',
      )}
      title={t('Návrhy na chaine')}
    >
      <Progress stage={stage} outcome={outcome} prefix={t('Návrh #')} />

      {proposals.length === 0 ? (
        <EmptyState>{t('Zatiaľ žiadne návrhy.')}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Úkon')}</th>
              <th>{t('Stav')}</th>
              <th>{t('Podpisy')}</th>
              <th>{t('Vykonateľné')}</th>
              <th>{t('Hlasovanie')}</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <tr
                key={p.id}
                id={`proposal-${p.id}`}
                className={highlighted === String(p.id) ? 'row-highlight' : undefined}
              >
                <td className="mono" title={`statusKey ${p.statusKey}`}>
                  {p.id}
                </td>
                <td>
                  {actionLabel(p.action)}
                  <div
                    className="muted"
                    title={
                      p.reasonHash && p.reasonHash !== NO_REASON ? `reasonHash ${p.reasonHash}` : ''
                    }
                  >
                    {p.reasonHash && p.reasonHash !== NO_REASON
                      ? t('dôvod zapečatený')
                      : t('bez dôvodu')}
                  </div>
                </td>
                <td>
                  <Badge tone={p.state} title={p.state}>
                    {proposalStateLabel(p.state)}
                  </Badge>
                </td>
                <td>
                  <Tally p={p} policy={info?.policies[p.action]} info={info} />
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
                    vetoBlocked={vetoRefusal(info?.policies[p.action], voterRole, p, voter)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <p className="footnote">
        {t(
          'Na chaine je výhradne kľúč záznamu certifikátu, solený commitment dôvodu a neosobné metadáta — žiadne meno, číslo licencie, DID držiteľa ani čitateľný dôvod (komponent 10.3). Kľúč sa nedá spätne prepočítať bez identifikátora licencie, ktorý pozná len držiteľ, ten, komu ju ukázal, a back-office. Dôvod je pevne daný pod každým podpisom a audítor ho overí v záložke Audit. Kľúč záznamu zobrazí podržanie myši nad číslom návrhu.',
        )}
      </p>
    </Panel>
  );
}
