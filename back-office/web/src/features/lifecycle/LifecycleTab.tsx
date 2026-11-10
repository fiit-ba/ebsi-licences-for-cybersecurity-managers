// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  approveProposal,
  emergencySuspend,
  listCertificates,
  listProposals,
  proposeChange,
  rejectProposal,
  reoffer,
} from '../../shared/api/lifecycle.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import OfferPanel from '../../shared/ui/OfferPanel.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import SelectField from '../../shared/ui/SelectField.tsx';
import StatCard from '../../shared/ui/StatCard.tsx';
import Table from '../../shared/ui/Table.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { proposalStateLabel } from '../../blockchain/governance.ts';
import { REASON_NOTE_MAX, REASONS_FOR, reasonLabel } from '../../shared/statusReasons.ts';
import { formatDate, t } from '../../shared/i18n/index.ts';
import { useHighlightedRow } from '../../shared/useHighlightedRow.ts';

/**
 * Build the existing localized lifecycle action labels.
 * @returns The existing localized action catalog.
 */
function lifecycleActions() {
  return {
    suspend: { label: t('Pozastaviť') },
    revoke: { label: t('Odňať') },
    reinstate: { label: t('Obnoviť platnosť') },
  };
}

/** How many pending proposals show before "show all". */
const PENDING_PREVIEW = 8;

/** How many open cases the panel asks for; the back-office gives at most this many. */
const CASES_LIMIT = 1000;

/** How many certificates one page of the list holds, and the most one request may ask for. */
const PAGE = 100;
const MAX_PAGE = 500;

/** Visible lifecycle pages reconcile with phone-issued certificates at this cadence. */
const AUTO_REFRESH_MS = 3000;

/** The columns of the certificate table, which a decision row spans. */
const CERTIFICATE_COLUMNS = 6;

/**
 * Classify the existing service-unavailable refusals for the lifecycle fallback.
 * @param error - Caught failure from the existing backend, browser or contract operation.
 * @returns Whether the refusal denotes an unavailable lifecycle service.
 */
function isUnavailable(error) {
  return (
    error.status === 404 ||
    /NotFoundException at \/registry\/certificates\/?/.test(error.message) ||
    /\/registry\/certificates\/?/.test(error.message)
  );
}

/**
 * Resolve the certificate lifecycle state to its existing localized display label.
 * @param state - Existing proposal, certificate or presentation state identifier.
 * @returns The localized state label or its original unknown value.
 */
function stateLabel(state) {
  const labels = {
    active: t('platný'),
    suspended: t('pozastavený'),
    revoked: t('odňatý'),
    expired: t('exspirovaný'),
    uncollected: t('nevyzdvihnutý'),
  };
  return labels[state] ?? state;
}

/**
 * Whom the operator may suspend at once (D25), as the back-office said it in
 * `registry/me`: a TI its own certificates, a TAO those of the TIs it
 * selected, the RootTAO any.
 * @param scope - Existing presentation or emergency-authorization scope.
 * @param managesStatus - Whether the operator holds ordinary status-management authority.
 * @returns The existing explanation of emergency authority.
 */
function emergencyScopeHint(scope, managesStatus) {
  if (scope === 'own')
    return t('Núdzovo pozastaviť môžete len certifikáty, ktoré vydala vaša organizácia.');
  if (scope === 'selected')
    return t('Núdzovo pozastaviť môžete certifikáty TI, ktoré ste vybrali.');
  if (scope === 'all') return t('Núdzovo pozastaviť môžete ktorýkoľvek certifikát v registri.');
  return managesStatus
    ? t(
        'Núdzovo pozastavuje len TI, ktorá certifikát vydala, TAO, ktorý túto TI vybral, alebo RootTAO.',
      )
    : '';
}

/**
 * Render the existing per-certificate status, emergency and replacement-offer actions.
 * @param options - Existing component inputs: {actions, busy, issues, managesStatus, onEmergency, onNewOffer, onPropose, row}.
 * @returns The rendered React content.
 */
function RowActions(options) {
  const { actions, busy, issues, managesStatus, onEmergency, onNewOffer, onPropose, row } = options;

  const canChangeStatus = row.collected && !row.has_open_proposal;
  const transitionActions = managesStatus && canChangeStatus ? row.allowed_actions : [];
  // The back-office says per certificate whether this account may (D25).
  const canEmergency = row.can_emergency_suspend && canChangeStatus && row.state === 'active';
  const canReoffer = issues && !row.collected && row.effective_state === 'active';

  if (row.has_open_proposal) {
    return <span className="muted">{t('čaká na schválenie')}</span>;
  }

  if (transitionActions.length === 0 && !canEmergency && !canReoffer) {
    return <span className="muted">—</span>;
  }

  return (
    <div className="row-actions" aria-label={t('Akcie')}>
      {transitionActions.map((name) => (
        <Button
          key={name}
          size="sm"
          variant="ghost"
          disabled={busy === `${row.credential_id}:${name}`}
          onClick={() => onPropose(row, name)}
        >
          {actions[name]?.label ?? name}
        </Button>
      ))}
      {canEmergency && (
        <Button
          className="danger"
          size="sm"
          variant="ghost"
          disabled={busy === `${row.credential_id}:emergency`}
          onClick={() => onEmergency(row)}
        >
          {t('Núdzovo pozastaviť')}
        </Button>
      )}
      {canReoffer && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy === `${row.credential_id}:offer`}
          onClick={() => onNewOffer(row)}
        >
          {t('Nová ponuka')}
        </Button>
      )}
    </div>
  );
}

/**
 * Why, for the one change being decided (design decisions D22): a reason the
 * action may give - a suspension and a revocation must give one - and a note,
 * which "other" needs. Both stay in the back-office; the chain gets only their
 * salted commitment.
 * @param options - Existing component inputs: {action, actionLabel, busy, certificate, onCancel, onSubmit}.
 * @returns The rendered React content.
 */
function DecisionRow(options) {
  const { action, actionLabel, busy, certificate, onCancel, onSubmit } = options;

  const reasons = REASONS_FOR[action];
  const [reason, setReason] = useState(action === 'emergency' ? 'key_compromise' : reasons[0]);
  const [note, setNote] = useState('');
  const missing = reason === 'other' && !note.trim();
  const emergency = action === 'emergency';

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function submit(event) {
    event.preventDefault();
    if (!missing) onSubmit(reason, note.trim());
  }

  return (
    <tr className="decision-row">
      <td colSpan={CERTIFICATE_COLUMNS}>
        <form className="decision" onSubmit={submit}>
          <b>
            {actionLabel} — {certificate}
          </b>
          {emergency && (
            <p className="muted mt-1">
              {t(
                'Pozastavenie nastane hneď, na rozhodnutie jedného človeka (komponent 10.6) — pre nahlásené kompromitovanie kľúča. Je vratné; trvalé odňatie potom potrebuje riadne schválenie.',
              )}
            </p>
          )}
          <div className="grid">
            <SelectField
              id="decision-reason"
              label={t('Dôvod')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {reasons.map((code) => (
                <option key={code} value={code}>
                  {reasonLabel(code)}
                </option>
              ))}
            </SelectField>
            <Field
              id="decision-note"
              label={reason === 'other' ? t('Poznámka (povinná)') : t('Poznámka (voliteľná)')}
            >
              <TextInput
                id="decision-note"
                value={note}
                maxLength={REASON_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('napr. číslo rozhodnutia alebo spisu')}
              />
            </Field>
          </div>
          <FormActions>
            <Button
              type="submit"
              className={emergency ? 'danger' : undefined}
              disabled={missing || busy}
            >
              {emergency ? t('Pozastaviť teraz') : t('Navrhnúť')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('Zrušiť')}
            </Button>
          </FormActions>
          <p className="footnote">
            {t(
              'Dôvod a poznámka ostávajú v back-office. Na chain ide s návrhom len ich solený commitment — dôvod je tak pevne daný už pri otvorení návrhu a audítor ho vie overiť, no z ledgeru sa nedá vyčítať (komponent 10.3).',
            )}
          </p>
        </form>
      </td>
    </tr>
  );
}

/**
 * The certificate lifecycle (component 1.1), for whoever holds the role.
 *
 * A status manager proposes a change, and a *different* status manager
 * approves it (four-eyes, component 1) - the second panel lists what waits.
 * With the governance contract configured, an on-chain quorum comes on top
 * before any bit moves (component 10.5). Emergency suspension is the one
 * exception: one person, at once, for a compromised key (component 10.6) -
 * the TI that issued the certificate, the TAO that selected that TI, or the
 * RootTAO (D25), which is why those two see this tab too.
 *
 * The rows offer only what the certificate's state and the operator's roles
 * allow. The back-office decides either way; a button that cannot be pressed
 * is a better answer than an error after the fact.
 * @param options - Existing component inputs: {roles = [], emergencyScope = ''}.
 * @returns The rendered React content.
 */
export default function LifecycleTab(options) {
  const { roles = [], emergencyScope = '' } = options;

  const actions = lifecycleActions();
  const managesStatus = roles.includes('plr_status_manager');
  const issues = roles.includes('plr_issuer');
  // Open cases are listed to status managers and auditors only.
  const seesCases = managesStatus || roles.includes('plr_auditor');
  const scopeHint = emergencyScopeHint(emergencyScope, managesStatus);

  // A page of the certificates at a time: the back-office searches and
  // filters all of them, says how many match (`total`) and where the next
  // page starts, and counts the operator's whole scope by state (`summary`).
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cases, setCases] = useState([]);
  const [casesTotal, setCasesTotal] = useState(0);
  // A case a sign-in notice links to (?case=…).
  const highlightedCase = useHighlightedRow('case', cases.length > 0);
  const [error, setError] = useState('');
  const [stateDraft, setStateDraft] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  // The change being decided: {row, action}, the action one of the row's or
  // 'emergency'. Its reason is chosen in a row under the certificate.
  const [deciding, setDeciding] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [offer, setOffer] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Certificates the back-office could not decrypt (KMS unreachable, or its
  // key lost): left out of the list, and said so rather than hidden.
  const [unreadable, setUnreadable] = useState(0);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const inFlightRef = useRef(0);
  const loadErrorRef = useRef(false);
  const visibleRowsRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const filters = useCallback(
    () => ({ ...(stateFilter ? { state: stateFilter } : {}), ...(search ? { q: search } : {}) }),
    [stateFilter, search],
  );

  /**
   * Read the current certificate page and open lifecycle cases.
   *
   * `keep` reloads as many rows as are on screen, so an automatic refresh or
   * action does not return the operator to the first page. Background failures
   * retain the last usable view and a monotonically increasing request number
   * prevents an older response from replacing a newer filter result.
   *
   * @param keep - Number of currently visible certificate rows to retain.
   * @param options - Whether this is a non-disruptive automatic refresh.
   * @returns No value; fresh responses replace the visible lifecycle data.
   */
  const load = useCallback(
    async (keep = 0, { background = false } = {}) => {
      if (background && inFlightRef.current > 0) return;

      const request = requestRef.current + 1;
      requestRef.current = request;
      inFlightRef.current += 1;
      const fresh = () => mountedRef.current && request === requestRef.current;

      if (!background) {
        loadErrorRef.current = false;
        setError('');
        setUnavailable(false);
      }
      try {
        const [certificates, open] = await Promise.all([
          listCertificates({ ...filters(), limit: Math.min(Math.max(keep, PAGE), MAX_PAGE) }),
          seesCases
            ? listProposals({ limit: CASES_LIMIT }).catch(() => ({ results: [] }))
            : { results: [] },
        ]);
        if (!fresh()) return;

        if (loadErrorRef.current) {
          loadErrorRef.current = false;
          setError('');
        }
        setUnavailable(false);
        visibleRowsRef.current = certificates.results.length;
        setRows(certificates.results);
        setTotal(certificates.total ?? certificates.results.length);
        setNext(certificates.next ?? null);
        setSummary(certificates.summary ?? null);
        setUnreadable(certificates.unreadable || 0);
        setCases(open.results);
        setCasesTotal(open.total ?? open.results.length);
      } catch (e) {
        if (!fresh() || background) return;

        loadErrorRef.current = true;
        if (isUnavailable(e)) {
          setUnavailable(true);
        } else {
          setError(e.message);
        }
        visibleRowsRef.current = 0;
        setRows([]);
        setTotal(0);
        setNext(null);
        setSummary(null);
        setUnreadable(0);
        setCases([]);
        setCasesTotal(0);
      } finally {
        inFlightRef.current -= 1;
      }
    },
    [filters, seesCases],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    /**
     * Reconcile phone-side issuance only while the operator can see the result.
     * @returns No value; a permitted refresh updates state asynchronously.
     */
    function refreshVisibleLifecycle() {
      if (document.visibilityState !== 'visible' || busy || loadingMore) return;
      void load(visibleRowsRef.current, { background: true });
    }

    const timer = window.setInterval(refreshVisibleLifecycle, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisibleLifecycle);
    window.addEventListener('focus', refreshVisibleLifecycle);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisibleLifecycle);
      window.removeEventListener('focus', refreshVisibleLifecycle);
    };
  }, [busy, load, loadingMore]);

  /**
   * Append the next server-provided certificate page to the current filtered registry.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function loadMore() {
    const request = requestRef.current + 1;
    requestRef.current = request;
    inFlightRef.current += 1;
    const fresh = () => mountedRef.current && request === requestRef.current;

    setLoadingMore(true);
    loadErrorRef.current = false;
    setError('');
    try {
      const page = await listCertificates({ ...filters(), limit: PAGE, offset: next });
      if (!fresh()) return;

      // A certificate issued meanwhile moves the rest down by one; it is
      // already on screen, and shown once.
      setRows((current) => {
        const shown = new Set(current.map((row) => row.credential_id));
        const merged = [...current, ...page.results.filter((row) => !shown.has(row.credential_id))];
        visibleRowsRef.current = merged.length;
        return merged;
      });
      setTotal(page.total ?? total);
      setNext(page.next ?? null);
      // A search reads every certificate each time, a plain page only its own.
      setUnreadable((count) => (search ? 0 : count) + (page.unreadable || 0));
    } catch (e) {
      if (fresh()) {
        loadErrorRef.current = true;
        setError(e.message);
      }
    } finally {
      inFlightRef.current -= 1;
      if (mountedRef.current) setLoadingMore(false);
    }
  }

  /**
   * Run the requested operation and retain its existing visible result and refusal state.
   * @param key - Query parameter or operation identifier.
   * @param work - Existing asynchronous lifecycle operation.
   * @param describe - Builds the existing operation completion message.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function run(key, work, describe) {
    setBusy(key);
    setError('');
    setNotice(null);
    try {
      const result = await work();
      setNotice(describe(result));
      await load(rows ? rows.length : 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const label = (row) => row.reference || row.holder_reference;

  const decide = (row, action) => {
    setNotice(null);
    setError('');
    setDeciding({ row, action });
  };

  const propose = (row, action, reasonCode, reasonNote) =>
    run(
      `${row.credential_id}:${action}`,
      async () => {
        const result = await proposeChange({
          credential_id: row.credential_id,
          action,
          reason_code: reasonCode,
          reason_note: reasonNote,
        });
        setDeciding(null);
        return result;
      },
      () =>
        t('Návrh „{0}“ pre {1} je zaevidovaný. Schváliť ho musí iný správca statusov.', [
          actions[action]?.label ?? action,
          label(row),
        ]),
    );

  const approve = (item) =>
    run(
      `case:${item.proposal_id}`,
      () => approveProposal(item.proposal_id),
      (result) =>
        result.applied
          ? t('Schválené a vykonané — certifikát je {0}.', [stateLabel(result.state)])
          : t('Schválené. Zmena nastane, keď ju potvrdí kontrakt riadenia (komponent 10.5).'),
    );

  const reject = (item) =>
    run(
      `case:${item.proposal_id}`,
      () => rejectProposal(item.proposal_id),
      () => t('Návrh je zamietnutý; certifikát ostáva bez zmeny.'),
    );

  const emergency = (row, reasonCode, reasonNote) =>
    run(
      `${row.credential_id}:emergency`,
      async () => {
        const result = await emergencySuspend(row.credential_id, reasonCode, reasonNote);
        setDeciding(null);
        return result;
      },
      () => t('{0} je pozastavený.', [label(row)]),
    );

  /**
   * Request a replacement handoff for the selected uncollected certificate.
   * @param row - Selected organization or certificate row returned by the existing API.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function newOffer(row) {
    setBusy(`${row.credential_id}:offer`);
    setError('');
    try {
      setOffer({ ...(await reoffer(row.credential_id)), reference: label(row) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  /**
   * Apply the entered search and state filters to the existing registry query.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function applyFilters(event) {
    event.preventDefault();
    setStateFilter(stateDraft);
    setSearch(searchDraft.trim());
  }

  /**
   * Restore the existing unfiltered registry query.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function clearFilters() {
    setStateDraft('');
    setStateFilter('');
    setSearchDraft('');
    setSearch('');
  }

  // Counted by the back-office over every certificate the operator sees,
  // whatever the page and the filters.
  const stat = (key) => (summary ? summary[key] : '…');
  const shownCases = showAll ? cases : cases.slice(0, PENDING_PREVIEW);
  const filtered = Boolean(stateFilter || search);

  return (
    <>
      <div className="stats">
        <StatCard label={t('Certifikáty')} value={stat('all')} />
        <StatCard label={t('Platné')} value={stat('valid')} tone="ok" />
        <StatCard label={t('Pozastavené')} value={stat('suspended')} tone="warn" />
        <StatCard label={t('Odňaté')} value={stat('revoked')} tone="danger" />
        {seesCases && <StatCard label={t('Čakajúce návrhy')} value={casesTotal} tone="accent" />}
      </div>

      {cases.length > 0 && (
        <Panel
          hint={t(
            'Schváliť môže len iný správca statusov než ten, kto zmenu navrhol (štvor-oký princíp, komponent 1).',
          )}
          title={t('Čakajúce návrhy')}
        >
          <Table>
            <thead>
              <tr>
                <th>{t('Certifikát')}</th>
                <th>{t('Úkon')}</th>
                <th>{t('Navrhol')}</th>
                <th>{t('Dôvod')}</th>
                <th>{t('Stav')}</th>
                <th>{t('Rozhodnutie')}</th>
              </tr>
            </thead>
            <tbody>
              {shownCases.map((item) => (
                <tr
                  key={item.proposal_id}
                  id={`case-${item.proposal_id}`}
                  className={highlightedCase === item.proposal_id ? 'row-highlight' : undefined}
                >
                  <td className="mono">{item.reference || item.credential_id.slice(-12)}</td>
                  <td>{actions[item.action]?.label ?? item.action}</td>
                  <td>{item.proposed_by}</td>
                  <td>
                    {reasonLabel(item.reason_code || 'none')}
                    {item.reason_note && <div className="muted">{item.reason_note}</div>}
                  </td>
                  <td>
                    {item.approved
                      ? t('schválený · na chaine {0}', [proposalStateLabel(item.onchain_state)])
                      : item.onchain_proposal_id
                        ? t('na chaine #{0}', [item.onchain_proposal_id])
                        : t('čaká na schválenie')}
                  </td>
                  <td>
                    {managesStatus && !item.approved ? (
                      <div className="actions">
                        <Button
                          size="sm"
                          disabled={!item.can_approve || busy === `case:${item.proposal_id}`}
                          title={item.can_approve ? '' : t('Vlastný návrh schváliť nemôžete.')}
                          onClick={() => approve(item)}
                        >
                          {t('Schváliť')}
                        </Button>
                        <Button
                          className="danger"
                          size="sm"
                          variant="ghost"
                          disabled={busy === `case:${item.proposal_id}`}
                          onClick={() => reject(item)}
                        >
                          {t('Zamietnuť')}
                        </Button>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {cases.length > PENDING_PREVIEW && (
            <FormActions>
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t('Zobraziť menej') : t('Zobraziť všetky ({0})', [cases.length])}
              </Button>
            </FormActions>
          )}
          {casesTotal > cases.length && (
            <p className="footnote">
              {t('Zobrazených {0} najnovších z {1}.', [cases.length, casesTotal])}
            </p>
          )}
        </Panel>
      )}

      <Panel
        hint={[
          t(
            'Každý riadok ponúka len prechody, ktoré jeho stav a vaše roly dovoľujú. Návrh sám o sebe nič nemení.',
          ),
          scopeHint,
        ]
          .filter(Boolean)
          .join(' ')}
        title={t('Vydané certifikáty')}
      >
        <form className="lifecycle-filters" onSubmit={applyFilters}>
          <SelectField
            id="flt"
            label={t('Stav')}
            value={stateDraft}
            onChange={(e) => setStateDraft(e.target.value)}
          >
            <option value="">{t('všetky')}</option>
            <option value="active">{t('platné')}</option>
            <option value="suspended">{t('pozastavené')}</option>
            <option value="revoked">{t('odňaté')}</option>
          </SelectField>
          <Field id="certificate-search" label={t('Vyhľadať certifikát')}>
            <TextInput
              id="certificate-search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={t('napr. 121 alebo spis-2026-0001')}
            />
          </Field>
          <FormActions className="lifecycle-filter-actions">
            <Button type="submit">{t('Vyhľadať')}</Button>
            {(stateFilter || search) && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                {t('Vyčistiť')}
              </Button>
            )}
          </FormActions>
        </form>

        {error && <Notice tone="err">{error}</Notice>}
        {unavailable && <LifecycleUnavailable />}
        {notice && <Notice tone="ok">{notice}</Notice>}

        {rows === null && <Notice>{t('Načítava sa…')}</Notice>}
        {unreadable > 0 && (
          <Notice tone="err">
            {t(
              'Niektoré certifikáty sa nedajú zobraziť, lebo ich údaje sa nepodarilo dešifrovať (počet: {0}). KMS je nedostupný alebo stratil kľúč, ktorým boli zašifrované. Kým sa to nevyrieši, tieto certifikáty sa tu nedajú spravovať.',
              [unreadable],
            )}
          </Notice>
        )}
        {rows !== null && rows.length === 0 && !filtered && !unavailable && !unreadable && (
          <Notice>{t('Žiadne certifikáty.')}</Notice>
        )}
        {rows !== null && rows.length === 0 && filtered && !unavailable && (
          <Notice>
            {t('Pre tento filter sa nenašiel žiadny certifikát.')}{' '}
            <button className="link-button" type="button" onClick={clearFilters}>
              {t('Vyčistiť')}
            </button>
          </Notice>
        )}

        {rows !== null && rows.length > 0 && (
          <Table spaced>
            <thead>
              <tr>
                <th className="cell-cert-number">{t('Číslo osvedčenia')}</th>
                <th className="cell-reference">{t('Referencia')}</th>
                <th>{t('Certifikačný orgán')}</th>
                <th>{t('Stav')}</th>
                <th className="nowrap">{t('Platnosť do')}</th>
                <th className="cell-actions">{t('Akcia')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.credential_id}>
                  <tr>
                    <td className="mono">{row.reference || '—'}</td>
                    <td className="mono">{row.holder_reference}</td>
                    <td>{row.certification_body || '—'}</td>
                    <td>
                      <Badge
                        tone={
                          !row.collected && row.state === 'active'
                            ? 'uncollected'
                            : row.effective_state
                        }
                      >
                        {stateLabel(
                          !row.collected && row.state === 'active'
                            ? 'uncollected'
                            : row.effective_state,
                        )}
                      </Badge>
                    </td>
                    <td className="mono nowrap">{formatDate(row.valid_until)}</td>
                    <td className="cell-actions">
                      <RowActions
                        actions={actions}
                        busy={busy}
                        issues={issues}
                        managesStatus={managesStatus}
                        row={row}
                        onEmergency={(r) => decide(r, 'emergency')}
                        onNewOffer={newOffer}
                        onPropose={decide}
                      />
                    </td>
                  </tr>
                  {deciding?.row.credential_id === row.credential_id && (
                    <DecisionRow
                      key={deciding.action}
                      action={deciding.action}
                      actionLabel={
                        deciding.action === 'emergency'
                          ? t('Núdzovo pozastaviť')
                          : actions[deciding.action]?.label
                      }
                      busy={Boolean(busy)}
                      certificate={label(row)}
                      onCancel={() => setDeciding(null)}
                      onSubmit={(reasonCode, reasonNote) =>
                        deciding.action === 'emergency'
                          ? emergency(row, reasonCode, reasonNote)
                          : propose(row, deciding.action, reasonCode, reasonNote)
                      }
                    />
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}

        {rows !== null && rows.length > 0 && (
          <FormActions>
            <span className="muted">{t('Zobrazených {0} z {1}.', [rows.length, total])}</span>
            {next !== null && (
              <Button size="sm" variant="ghost" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? t('Načítava sa…') : t('Načítať ďalšie')}
              </Button>
            )}
          </FormActions>
        )}

        <p className="footnote">
          {t('Stav')} <code>{t('exspirovaný')}</code> {t('sa odvodzuje z')} <code>validUntil</code>{' '}
          {t(
            'a záznam v registri certifikátov ho uvádza (komponent 1.1). Záznam vzniká, keď si držiteľ licenciu vyzdvihne. Identifikátor vyzdvihnutej licencie sa tu nezobrazuje — spája návrhy na chaine s certifikátom (komponent 1.2). Nová ponuka zruší predchádzajúcu a má vlastný PIN.',
          )}
        </p>
      </Panel>

      {offer && <OfferPanel offer={offer} title={t('Nová ponuka — {0}', [offer.reference])} />}
    </>
  );
}

/**
 * Render the existing unavailable-service guidance for the lifecycle screen.
 * @returns The rendered React content.
 */
function LifecycleUnavailable() {
  return (
    <Notice>
      <b>{t('Životný cyklus zatiaľ nie je dostupný.')}</b>{' '}
      {t(
        'Zoznam certifikátov sa zobrazí po tom, ako bude back-office pripravený alebo keď vznikne prvý certifikát.',
      )}
    </Notice>
  );
}
