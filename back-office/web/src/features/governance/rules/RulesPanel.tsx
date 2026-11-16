// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useCallback, useEffect, useRef, useState } from 'react';
import { governanceAdmin, governanceCheck } from '../../../shared/api/governance.ts';
import {
  castAdminVote,
  explainVoteError,
  listAdminProposals,
  tiIdOf,
} from '../../../blockchain/governance.ts';
import Button from '../../../shared/ui/Button.tsx';
import ConfirmDialog from '../../../shared/ui/ConfirmDialog.tsx';
import FormActions from '../../../shared/ui/FormActions.tsx';
import Notice from '../../../shared/ui/Notice.tsx';
import Panel from '../../../shared/ui/Panel.tsx';
import { t } from '../../../shared/i18n/index.ts';
import { adminDoneMessage } from '../governanceFormat.ts';
import Progress from '../components/Progress.tsx';
import AdminProposalTable from './AdminProposalTable.tsx';
import RuleChangeForm from './RuleChangeForm.tsx';
import { changeFrom, formFor, verdictNotice } from './ruleChange.ts';

/**
 * One TI's rules on the contract and changing them (component 10.4, design decisions D19).
 *
 * A change goes through the contract's own admin policy. The back-office adds
 * its rule for the certification body's keys: stricter is theirs to propose,
 * looser - or a different set of signers - only after the supervisory
 * authority has signed. The console asks the back-office rather than
 * restating that rule (registry/governance/admin/check); the back-office is
 * what enforces it.
 * @param options - Component inputs: {contract, ti, info, bounds, mode, role, voter, voterRole, canAct, isSigner, label, onChanged}.
 * @returns The rendered React content.
 */
export default function RulesPanel(options) {
  const {
    contract,
    ti,
    info,
    bounds,
    mode,
    role,
    voter,
    voterRole,
    canAct,
    isSigner,
    label,
    onChanged,
  } = options;

  const n = info.rolesPresent.length;
  const [changes, setChanges] = useState([]);
  const [cosign, setCosign] = useState({});
  const [form, setForm] = useState(() => formFor('set_policy', info));
  const [formTouched, setFormTouched] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [adminError, setAdminError] = useState('');
  const [busy, setBusy] = useState('');
  const [stage, setStage] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [pendingVeto, setPendingVeto] = useState(null);
  const loadRequest = useRef(0);
  const mountedRef = useRef(true);

  const byBackend = mode === 'backend';
  const { change, missing } = changeFrom(form);
  const key = JSON.stringify(change ?? null);

  const updateForm = (next) => {
    setFormTouched(true);
    setForm(next);
  };

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    const request = loadRequest.current + 1;
    loadRequest.current = request;
    const fresh = () => mountedRef.current && request === loadRequest.current;
    setAdminError('');
    try {
      const tiId = tiIdOf(ti).toLowerCase();
      const list = (await listAdminProposals(contract)).filter(
        (p) => String(p.tiId).toLowerCase() === tiId,
      );
      if (!fresh()) return;
      setChanges(list);
      // Whether the body's key may co-sign each open change, as the back-office sees it.
      if (byBackend && role) {
        const open = list.filter((p) => p.state === 'PROPOSED');
        const answers = await Promise.all(
          open.map((p) =>
            governanceCheck({ role, admin_proposal_id: String(p.id) }).catch(() => null),
          ),
        );
        if (!fresh()) return;
        setCosign(Object.fromEntries(open.map((p, i) => [p.id, answers[i]])));
      } else {
        setCosign({});
      }
    } catch (e) {
      if (fresh()) setAdminError(explainVoteError(e));
    }
  }, [byBackend, contract, role, ti]);

  // Set on every mount (StrictMode remounts once in development), and declared
  // before the load effect so the remount finds it set: effects run in order.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    load();
  }, [load, info.version]);

  useEffect(() => {
    if (!formTouched) {
      setForm((current) => formFor(current.action, info, current.kind));
    }
  }, [formTouched, info]);

  // Ask the back-office about the change in the form, once typing settles.
  useEffect(() => {
    setVerdict(null);
    if (!change) return undefined;
    let current = true;
    const asRole = voterRole || role;
    const timer = setTimeout(() => {
      // Before the roles load there is no role yet; the rule is then the body's.
      governanceCheck({ ...(asRole ? { role: asRole } : {}), change, ti })
        .then((answer) => current && setVerdict(answer))
        .catch((e) => current && setVerdict({ error: explainVoteError(e) }));
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, voterRole, role, info.version, ti]);

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param vote - Existing sign, execute, cancel, expire or propose operation.
   * @param target - Selected rule-change proposal; omitted when proposing a new change.
   * @param confirmed - Whether the existing destructive-action confirmation has completed.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function submit(vote: string, target?: { id: number }, confirmed = false) {
    if (!mountedRef.current) return;
    if (vote === 'cancel' && !confirmed) {
      setPendingVeto(target);
      return;
    }
    setBusy(vote === 'propose' ? 'propose' : `${target.id}:${vote}`);
    setOutcome(null);
    try {
      let tx;
      if (mode === 'wallet') {
        tx = await castAdminVote(
          contract,
          vote === 'propose' ? { vote, change, ti } : { vote, id: target.id },
          (name, hash) => mountedRef.current && setStage({ name, hash }),
        );
      } else {
        const r = await governanceAdmin(
          vote === 'propose'
            ? { vote, role, change, ti }
            : { vote, role, admin_proposal_id: String(target.id) },
        );
        tx = r.transaction_hash;
      }
      if (!mountedRef.current) return;
      setOutcome({ ok: true, text: adminDoneMessage(vote), tx });
      await load();
      await onChanged();
      if (!mountedRef.current) return;
      setFormTouched(false);
      setForm((current) => formFor(current.action, info, current.kind));
    } catch (e) {
      if (mountedRef.current) setOutcome({ ok: false, text: explainVoteError(e) });
    } finally {
      if (mountedRef.current) {
        setBusy('');
        setStage(null);
      }
    }
  }

  const notice = missing ? { tone: 'info', text: missing } : verdictNotice(verdict, voterRole);
  // Through the back-office the back-office's answer decides; a wallet's own key
  // answers to the contract alone, which simulates the call before sending.
  const canPropose = Boolean(change) && (byBackend ? Boolean(verdict?.allowed) : true);

  return (
    <Panel
      hint={t(
        'Každá TI má v kontrakte vlastné kľúče a pravidlá. Každý kľúč patrí jednej role — A a B sú kľúče DID samotnej TI, C podpisuje ktorýkoľvek platný kľúč DID orgánu dohľadu — a kvórum počíta roly, nie kľúče. Každý druh rozhodnutia má vlastné pravidlo: koľko rolí, ktoré z nich povinne, ktoré môžu vetovať a aký časový zámok. Pravidlá mení kontrakt vlastným kvórom podľa pravidla zmeny pravidiel (komponent 10.4).',
      )}
      title={t('Pravidlá kontraktu')}
    >
      <RuleChangeForm bounds={bounds} form={form} info={info} label={label} onForm={updateForm} />

      {adminError && <Notice tone="err">{adminError}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <FormActions>
        <Button
          disabled={!canPropose || !canAct || !isSigner || Boolean(busy)}
          onClick={() => submit('propose')}
        >
          {busy === 'propose' ? t('Odosiela sa…') : t('Navrhnúť zmenu')}
        </Button>
      </FormActions>

      <Progress stage={stage} outcome={outcome} />

      <AdminProposalTable
        byBackend={byBackend}
        canAct={canAct}
        changes={changes}
        cosign={cosign}
        info={info}
        isSigner={isSigner}
        label={label}
        n={n}
        busy={busy}
        voter={voter}
        voterRole={voterRole}
        onVote={(target, nextVote) => submit(nextVote, target)}
      />

      <p className="footnote">
        {t(
          'Pravidlo pre kľúče certifikačného orgánu: sprísniť multisig môže sám, uvoľniť ho alebo zmeniť signatárov len po podpise orgánu dohľadu — ten istý princíp ako pri vete, kde je zastavenie ľahké a rozhodnutie ťažké. Vlastné kľúče (A, B) môže vymeniť sám. Kľúče orgánu dohľadu sú v jeho vlastnom DID a mení ich len on; spolupodpisovateľov TI nastavuje TAO. Nikdy nie pod 2 roly. Jeden človek dá za certifikačný orgán najviac jeden podpis na jednu zmenu.',
        )}
        {voterRole === 'C' &&
          t(' Hlasujete ako orgán dohľadu, takže každú z týchto zmien môžete otvoriť.')}
      </p>
      <p className="footnote">
        {t(
          'Ak má zmena pravidiel časový zámok, po dosiahnutí kvóra čaká a vetovať ju môže signatár roly s právom veta alebo ten, kto ju navrhol — okrem kľúča, ktorý sa odoberá alebo vymieňa. Pri vykonaní sa kvórum overuje znova podľa platných pravidiel a počítajú sa len podpisy kľúčov, ktoré sú stále signatármi; odobratý kľúč sa signatárom už nestane. Kvórum, ktoré sa stratí a znova obnoví podpisom, spustí časový zámok odznova. Štvor-oký princíp v back-office ostáva dvaja ľudia bez ohľadu na pravidlá na chaine — je to iná kontrola (komponent 10.4).',
        )}
      </p>
      <ConfirmDialog
        open={Boolean(pendingVeto)}
        title={pendingVeto ? t('Vetovať zmenu pravidiel #{0}?', [pendingVeto.id]) : ''}
        confirmLabel={t('Vetovať zmenu')}
        cancelLabel={t('Zrušiť')}
        busy={Boolean(pendingVeto && busy === `${pendingVeto.id}:cancel`)}
        danger
        onCancel={() => setPendingVeto(null)}
        onConfirm={async () => {
          await submit('cancel', pendingVeto, true);
          if (mountedRef.current) setPendingVeto(null);
        }}
      >
        <p>{t('Veto jedného oprávneného signatára zmenu pravidiel okamžite uzavrie.')}</p>
        <p className="muted">{t('Rovnakú zmenu pravidiel možno neskôr navrhnúť znova.')}</p>
      </ConfirmDialog>
    </Panel>
  );
}
