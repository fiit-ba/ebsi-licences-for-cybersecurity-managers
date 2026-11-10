// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useMemo, useState } from 'react';
import { governanceSync, governanceVote } from '../../shared/api/governance.ts';
import {
  LEDGER_CHAIN_ID,
  castVote,
  explainVoteError,
  isBrowserWalletAvailable,
} from '../../blockchain/governance.ts';
import ConfirmDialog from '../../shared/ui/ConfirmDialog.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import { t } from '../../shared/i18n/index.ts';
import { useHighlightedRow } from '../../shared/useHighlightedRow.ts';
import AuditPanel from './components/AuditPanel.tsx';
import GovernanceOverview from './components/GovernanceOverview.tsx';
import ProposalTable from './components/ProposalTable.tsx';
import VotingPanel from './components/VotingPanel.tsx';
import { actionLabel, doneMessage, roleName, roleOfSigner, short } from './governanceFormat.ts';
import RulesPanel from './rules/RulesPanel.tsx';
import useGovernanceData from './useGovernanceData.ts';
import useGovernanceRoles from './useGovernanceRoles.ts';
import useWalletVoter from './useWalletVoter.ts';

/**
 * The Revocation Governance Contract (component 10): its state, and voting.
 *
 * Every TI has its own signers and rules on the contract; the tab shows one TI at a time. State
 * is read straight from the ledger rather than from the back-office's copy of it. Votes are cast
 * either from the signer's own wallet or with a role key KMS protects (see
 * shared/api/governance.ts).
 * @param options - Existing component inputs: {contract}.
 * @returns The rendered React content.
 */
export default function GovernanceTab(options) {
  const { contract } = options;

  const [mode, setMode] = useState(isBrowserWalletAvailable() ? 'wallet' : 'backend');
  const [busy, setBusy] = useState('');
  const [stage, setStage] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [pendingVeto, setPendingVeto] = useState(null);

  const { roles, role, setRole } = useGovernanceRoles();
  const { wallet, walletError, connect, switchChain } = useWalletVoter();
  // The TI shown: the operator's choice, else the back-office's default (the operator's own).
  const tis = roles?.tis ?? [];
  const [chosenTi, setTi] = useState('');
  const ti = chosenTi || roles?.ti || tis[0]?.did || '';
  const { info, proposals, error, loading, refresh } = useGovernanceData(
    contract,
    ti,
    mode === 'wallet' ? (wallet?.address ?? '') : '',
  );
  // A proposal a sign-in notice links to (?proposal=…).
  const highlightedProposal = useHighlightedRow('proposal', proposals.length > 0);

  // The TI's A and B keys, as the back-office holds them.
  const addressOfRole = useMemo(
    () =>
      (tis.find((item) => item.did === ti)?.addresses ?? roles?.addresses ?? {}) as Record<
        string,
        string
      >,
    [roles, tis, ti],
  );
  const roleOfAddress = useMemo(
    () => Object.fromEntries(Object.entries(addressOfRole).map(([r, a]) => [a.toLowerCase(), r])),
    [addressOfRole],
  );

  /**
   * "A" or "A · certifikačný orgán · navrhovateľ"; a short address for a non-signer.
   * @param address - Governance contract address on the configured ledger.
   * @param compact - Whether to show the existing short role/address label.
   * @returns The known role label or the original/shortened address.
   */

  function label(address, compact = false) {
    if (!address) return '';
    const r = roleOfSigner(info, address) ?? roleOfAddress[address.toLowerCase()];
    if (r) return compact ? r : `${r} · ${roleName(r) ?? t('rola')}`;
    return compact ? short(address) : address;
  }

  const wrongChain = mode === 'wallet' && wallet && wallet.chainId !== LEDGER_CHAIN_ID;
  const voter = mode === 'wallet' ? wallet?.address : addressOfRole[role];
  // The role a vote is cast as: the back-office's, or whatever the wallet's key holds.
  const voterRole = mode === 'wallet' ? (roleOfSigner(info, voter) ?? '') : role;
  // Unknown when the back-office does not say which address a role signs as; the
  // contract then has the last word.
  const voterIsSigner = !voter || !info ? mode === 'backend' : Boolean(roleOfSigner(info, voter));
  const canAct = mode === 'wallet' ? Boolean(wallet) && !wrongChain : Boolean(role);

  /**
   * Submit the selected governance vote through the chosen signer path and refresh ledger state.
   * @param p - Ledger proposal with its current ballot and proposer.
   * @param kind - Existing action, vote or policy kind.
   * @param confirmed - Whether the existing destructive-action confirmation has completed.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function vote(p, kind, confirmed = false) {
    if (kind === 'cancel' && !confirmed) {
      setPendingVeto(p);
      return;
    }
    setBusy(`${p.id}:${kind}`);
    setOutcome(null);
    try {
      if (mode === 'wallet') {
        const tx = await castVote(contract, p.id, kind, (name, hash) =>
          setStage({ id: p.id, name, hash }),
        );
        // The vote reached the contract without passing through the
        // back-office; tell it to look, or the registry never learns of it.
        let synced = true;
        try {
          await governanceSync(p.id);
        } catch {
          synced = false;
        }
        setOutcome({
          ok: true,
          id: p.id,
          text:
            doneMessage(kind) +
            (synced
              ? ''
              : t(' Back-office sa o hlase zatiaľ nedozvedel — prihláste sa a skúste to znova.')),
          tx,
        });
      } else {
        const r = await governanceVote(p.id, kind, role);
        setOutcome({
          ok: true,
          id: p.id,
          text: r.approved
            ? t(
                'Schválené v back-office ako druhý pracovník (štvor-oký princíp). Podpis roly B sa odosiela na chain.',
              )
            : doneMessage(kind),
          tx: r.transaction_hash,
        });
      }
      await refresh();
      // The back-office signs and reconciles in the background.
      setTimeout(refresh, 4000);
    } catch (e) {
      setOutcome({ ok: false, id: p.id, text: explainVoteError(e) });
    } finally {
      setBusy('');
      setStage(null);
    }
  }

  if (!contract) {
    return (
      <Panel
        hint={t(
          'Nie je nakonfigurovaný žiadny kontrakt. Back-office beží len na štvor-okom princípe, čo je pilotný stav pred nasadením kontraktu.',
        )}
        title={t('Kontrakt riadenia')}
      >
        <p className="footnote">
          {t(
            'Komponent 10.4 označuje obe kontroly za súbežné a chrániace pred odlišnými hrozbami, takže neprítomnosť kontraktu neoslabuje aplikačnú kontrolu. Nasadenie:',
          )}{' '}
          <code>cd contracts &amp;&amp; npm run deploy:besu</code>.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <GovernanceOverview
        error={error}
        info={info}
        label={label}
        loading={loading}
        onRefresh={refresh}
        tis={tis}
        ti={ti}
        onTi={setTi}
      />

      <VotingPanel
        mode={mode}
        onMode={setMode}
        roles={roles && { ...roles, addresses: addressOfRole }}
        role={role}
        onRole={setRole}
        wallet={wallet}
        wrongChain={wrongChain}
        isSigner={voterIsSigner}
        label={label}
        walletError={walletError}
        onConnect={connect}
        onSwitch={switchChain}
      />

      <ProposalTable
        proposals={proposals}
        highlighted={highlightedProposal}
        info={info}
        voter={voter}
        voterRole={voterRole}
        canAct={canAct}
        isSigner={voterIsSigner}
        busy={busy}
        stage={stage}
        outcome={outcome}
        onVote={vote}
      />

      {info?.ti && (
        <RulesPanel
          key={info.ti}
          contract={contract}
          ti={info.ti}
          info={info}
          bounds={roles?.bounds}
          mode={mode}
          role={role}
          voter={voter}
          voterRole={voterRole}
          canAct={canAct}
          isSigner={voterIsSigner}
          label={label}
          onChanged={refresh}
        />
      )}

      <AuditPanel contract={contract} />

      <ConfirmDialog
        open={Boolean(pendingVeto)}
        title={
          pendingVeto
            ? t('Vetovať návrh #{0} ({1})?', [pendingVeto.id, actionLabel(pendingVeto.action)])
            : ''
        }
        confirmLabel={t('Vetovať návrh')}
        cancelLabel={t('Zrušiť')}
        busy={Boolean(pendingVeto && busy === `${pendingVeto.id}:cancel`)}
        danger
        onCancel={() => setPendingVeto(null)}
        onConfirm={async () => {
          await vote(pendingVeto, 'cancel', true);
          setPendingVeto(null);
        }}
      >
        <p>{t('Veto jedného oprávneného signatára návrh okamžite uzavrie.')}</p>
        <p className="muted">
          {t('Certifikát zostane bez zmeny; rovnakú zmenu možno navrhnúť znova.')}
        </p>
      </ConfirmDialog>
    </>
  );
}
