// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useState } from 'react';
import { anchors, auditLog, commitmentPreimage, reasonPreimage } from '../../shared/api/audit.ts';
import { verifyRecordKey, verifyReason } from '../../blockchain/governance.ts';
import { reasonLabel } from '../../shared/statusReasons.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import ConfirmDialog from '../../shared/ui/ConfirmDialog.tsx';
import EmptyState from '../../shared/ui/EmptyState.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import KeyValue from '../../shared/ui/KeyValue.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import Table from '../../shared/ui/Table.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { formatDateTime, t } from '../../shared/i18n/index.ts';

/**
 * The auditor's view (components 1, 9, 10.7).
 *
 * The append-only log with whether its hash chain is intact; for one
 * certificate, its decisions as anchored in the EBSI Timestamp API and read
 * back; and what its record key on the certificate registry is computed from,
 * checked in the registry itself. Handing out the collected credential's id is
 * recorded in the log - it is what links a holder to an on-chain proposal,
 * which is the audit's point and the reason nobody else sees it.
 * @param options - Existing component inputs: {contract}.
 * @returns The rendered React content.
 */
export default function AuditTab(options) {
  const { contract } = options;

  const [log, setLog] = useState(null);
  const [error, setError] = useState('');
  const [credentialId, setCredentialId] = useState('');

  /**
   * Load the current journal filter and expose its existing loading or failure state.
   * @param filter - Existing optional certificate filter for the journal.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function load(filter = '') {
    setError('');
    try {
      setLog(await auditLog(filter));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <Panel
        hint={t(
          'Záznamy sa nedajú upraviť ani zmazať a sú zreťazené hashmi, takže zásah priamo v databáze je zistiteľný (komponent 1).',
        )}
        title={t('Auditný záznam')}
      >
        {log && <ChainState chain={log.chain} />}
        <FormActions>
          <TextInput
            className="max-md"
            value={credentialId}
            placeholder={t('napr. urn:uuid:… alebo spis-2026-0001')}
            onChange={(e) => setCredentialId(e.target.value)}
          />
          <Button size="sm" variant="ghost" onClick={() => load(credentialId.trim())}>
            {t('Filtrovať')}
          </Button>
        </FormActions>
        {error && <Notice tone="err">{error}</Notice>}
        {log && (
          <Table spaced>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('Čas')}</th>
                <th>{t('Udalosť')}</th>
                <th>{t('Kto')}</th>
                <th>{t('Detail')}</th>
              </tr>
            </thead>
            <tbody>
              {log.results.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.id}</td>
                  <td className="mono">{formatDateTime(entry.occurred_at)}</td>
                  <td className="mono">{entry.event}</td>
                  <td>{entry.actor ?? t('systém')}</td>
                  <td className="mono trunc" title={JSON.stringify(entry.detail)}>
                    {Object.entries(entry.detail)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <CertificateAudit contract={contract} />
      {contract && <ReasonAudit contract={contract} />}
    </>
  );
}

/**
 * A proposal's reason against the chain (design decisions D22). The chain holds
 * only the reason's salted commitment; given the category, the note and the
 * salt, the contract recomputes it. The disclosure is recorded in the log.
 * @param options - Existing component inputs: {contract}.
 * @returns The rendered React content.
 */
function ReasonAudit(options) {
  const { contract } = options;

  const [proposalId, setProposalId] = useState('');
  const [disclosed, setDisclosed] = useState(null);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState('');
  const [confirmDisclosure, setConfirmDisclosure] = useState(false);
  const [disclosing, setDisclosing] = useState(false);

  /**
   * Run the requested operation and retain its existing visible result and refusal state.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function run() {
    setDisclosing(true);
    setError('');
    setDisclosed(null);
    setCheck(null);
    try {
      const preimage = await reasonPreimage(proposalId.trim());
      setDisclosed(preimage);
      const result = await verifyReason(contract, Number(proposalId), {
        code: preimage.reason_code,
        note: preimage.reason_note,
        salt: preimage.salt,
      });
      setCheck(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setDisclosing(false);
      setConfirmDisclosure(false);
    }
  }

  return (
    <Panel
      hint={t(
        'Na chaine je dôvod návrhu len ako solený commitment. Audítor získa z back-office kategóriu, poznámku a soľ a kontrakt z nich commitment prepočíta (design decisions D22).',
      )}
      title={t('Dôvod návrhu')}
    >
      <FormActions>
        <TextInput
          className="max-sm"
          placeholder={t('napr. 12')}
          value={proposalId}
          onChange={(e) => setProposalId(e.target.value)}
        />
        <Button
          variant="ghost"
          disabled={!/^[1-9][0-9]*$/.test(proposalId.trim())}
          onClick={() => setConfirmDisclosure(true)}
        >
          {t('Overiť dôvod')}
        </Button>
      </FormActions>
      {error && <Notice tone="err">{error}</Notice>}
      {disclosed && (
        <KeyValue className="mt-3">
          <dt>{t('dôvod')}</dt>
          <dd>{reasonLabel(disclosed.reason_code)}</dd>
          <dt>{t('poznámka')}</dt>
          <dd>{disclosed.reason_note || '—'}</dd>
          <dt>salt</dt>
          <dd className="mono">{disclosed.salt}</dd>
          <dt>reasonHash</dt>
          <dd className="mono">0x{disclosed.reason_hash}</dd>
        </KeyValue>
      )}
      {check && (
        <Notice tone={check.matches ? 'ok' : 'err'}>
          {check.matches
            ? t('Zhoda — návrh na chaine bol otvorený práve s týmto dôvodom.')
            : t('Nezhoda — tento dôvod nezodpovedá commitmentu v návrhu.')}
        </Notice>
      )}
      <p className="footnote">
        {t('Každé sprístupnenie je v audit logu ako')} <code>audit.reason_disclosed</code>{' '}
        {t('— bez poznámky a soli.')}
      </p>
      <ConfirmDialog
        open={confirmDisclosure}
        title={t('Sprístupniť dôvod návrhu #{0}?', [proposalId])}
        confirmLabel={disclosing ? t('Sprístupňuje sa…') : t('Sprístupniť')}
        cancelLabel={t('Zrušiť')}
        busy={disclosing}
        onCancel={() => setConfirmDisclosure(false)}
        onConfirm={run}
      >
        <p>{t('Zobrazí sa kategória dôvodu, interná poznámka a kryptografická soľ.')}</p>
        <p className="muted">{t('Sprístupnenie sa zaznamená do audit logu.')}</p>
      </ConfirmDialog>
    </Panel>
  );
}

/**
 * Render certificate timestamp evidence and explicitly requested commitment disclosure.
 * @param options - Existing component inputs: {contract}.
 * @returns The rendered React content.
 */
function CertificateAudit(options) {
  const { contract } = options;

  const [credentialId, setCredentialId] = useState('');
  const [anchored, setAnchored] = useState(null);
  const [preimage, setPreimage] = useState(null);
  const [proposalId, setProposalId] = useState('');
  const [check, setCheck] = useState(null);
  const [error, setError] = useState('');
  const [confirmDisclosure, setConfirmDisclosure] = useState(false);
  const [disclosing, setDisclosing] = useState(false);

  /**
   * Load the selected certificate timestamp evidence from the current backend.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function loadAnchors() {
    setError('');
    setAnchored(null);
    try {
      setAnchored((await anchors(credentialId.trim())).results);
    } catch (e) {
      setError(e.message);
    }
  }

  /**
   * Request what the certificate's record key is computed from, after explicit confirmation.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function disclose() {
    setDisclosing(true);
    setError('');
    try {
      setPreimage(await commitmentPreimage(credentialId.trim()));
      setCheck(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setDisclosing(false);
      setConfirmDisclosure(false);
    }
  }

  /**
   * Verify that a proposal names the disclosed certificate's record, with the configured reader.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function verifyOnChain() {
    setCheck({ state: 'running' });
    try {
      const result = await verifyRecordKey(contract, Number(proposalId), {
        issuerDid: preimage.issuer_did,
        certificateId: preimage.certificate_id,
      });
      setCheck({ state: 'done', ...result });
    } catch (e) {
      setCheck({ state: 'error', message: e.message });
    }
  }

  return (
    <Panel
      hint={t(
        'Rozhodnutia ukotvené v EBSI Timestamp API (komponent 9) a overenie, že návrh v kontrakte riadenia patrí k tomuto certifikátu (komponent 10.7).',
      )}
      title={t('Audit certifikátu')}
    >
      <div className="grid">
        <Field id="au-cid" label="credential_id">
          <TextInput
            id="au-cid"
            value={credentialId}
            placeholder={t('napr. urn:uuid:… alebo spis-2026-0001')}
            onChange={(e) => setCredentialId(e.target.value)}
          />
        </Field>
      </div>
      <FormActions>
        <Button variant="ghost" disabled={!credentialId.trim()} onClick={loadAnchors}>
          {t('Ukotvené rozhodnutia')}
        </Button>
      </FormActions>
      {error && <Notice tone="err">{error}</Notice>}

      {anchored && (
        <div className="mt-3">
          {anchored.length === 0 ? (
            <EmptyState>{t('Žiadne ukotvené rozhodnutia.')}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t('Rozhodnutie')}</th>
                  <th>{t('Ukotvené')}</th>
                  <th>{t('Záznam sedí s digestom')}</th>
                  <th>{t('Digest na ledgeri')}</th>
                </tr>
              </thead>
              <tbody>
                {anchored.map((a) => (
                  <tr key={a.digest}>
                    <td>{a.kind}</td>
                    <td className="mono">
                      {a.timestamp ? formatDateTime(a.timestamp) : t('čaká')}
                    </td>
                    <td>{badge(a.digest_matches)}</td>
                    <td>{badge(a.anchored)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}

      <section className="audit-section">
        <h2>{t('Kľúč záznamu v registri certifikátov')}</h2>
        <p className="footnote">
          {t(
            'Certifikát má jeden záznam a jeden kľúč pre všetky návrhy — pozastavenie, odňatie aj obnovenie — z TI, ktorá ho vydala, a identifikátora vyzdvihnutej licencie.',
          )}
        </p>
        <FormActions>
          <Button
            variant="ghost"
            disabled={!credentialId.trim()}
            onClick={() => setConfirmDisclosure(true)}
          >
            {t('Získať identifikátor licencie')}
          </Button>
        </FormActions>
        {preimage && (
          <>
            <KeyValue className="mt-3">
              <dt>issuerDid</dt>
              <dd>{preimage.issuer_did}</dd>
              <dt>certificateNumber</dt>
              <dd>{preimage.certificate_number}</dd>
              <dt>certificateId</dt>
              <dd>{preimage.certificate_id ?? t('— licencia ešte nebola vyzdvihnutá')}</dd>
              <dt>statusKey</dt>
              <dd className="mono">{preimage.status_key ?? '—'}</dd>
            </KeyValue>
            {contract && preimage.certificate_id && (
              <FormActions>
                <TextInput
                  className="max-sm"
                  placeholder={t('napr. 12')}
                  value={proposalId}
                  onChange={(e) => setProposalId(e.target.value)}
                />
                <Button variant="ghost" disabled={!proposalId} onClick={verifyOnChain}>
                  {t('Overiť v kontrakte')}
                </Button>
              </FormActions>
            )}
            {check?.state === 'done' && (
              <Notice tone={check.matches ? 'ok' : 'err'}>
                {check.matches
                  ? t('Zhoda — návrh na chaine patrí k tomuto certifikátu.')
                  : t('Nezhoda — návrh na chaine sa týka iného záznamu.')}
              </Notice>
            )}
            {check?.state === 'error' && <Notice tone="err">{check.message}</Notice>}
          </>
        )}
        <p className="footnote">
          {t(
            'Kľúč vypočíta register certifikátov, teda rovnaká cesta, akú by použil nezávislý audítor. Každé sprístupnenie je v audit logu ako',
          )}{' '}
          <code>audit.preimage_disclosed</code>.
        </p>
      </section>
      <ConfirmDialog
        open={confirmDisclosure}
        title={t('Sprístupniť identifikátor licencie?')}
        confirmLabel={disclosing ? t('Sprístupňuje sa…') : t('Sprístupniť')}
        cancelLabel={t('Zrušiť')}
        busy={disclosing}
        onCancel={() => setConfirmDisclosure(false)}
        onConfirm={disclose}
      >
        <p>
          {t(
            'Kto pozná DID vydavateľa a identifikátor licencie, dokáže spojiť návrh na chaine s týmto certifikátom.',
          )}
        </p>
        <p className="muted">{t('Sprístupnenie sa zaznamená do audit logu.')}</p>
      </ConfirmDialog>
    </Panel>
  );
}

/**
 * Map an audit verification result to its existing badge text and tone.
 * @param value - Current input or state value.
 * @returns The existing yes/no badge, or the unevaluated marker.
 */
function badge(value) {
  if (value === true) return <Badge tone="VALID">{t('áno')}</Badge>;
  if (value === false) return <Badge tone="REVOKED">{t('nie')}</Badge>;
  return <span className="muted">—</span>;
}

/**
 * Tampering and a concurrent-write fork are different findings: an edited or
 * deleted entry is a breach; a fork is two writers that raced, each entry
 * intact, from before the writer was serialised.
 * @param options - Existing component inputs: {chain}.
 * @returns The rendered React content.
 */
function ChainState(options) {
  const { chain } = options;

  if (chain.intact) {
    return <Notice tone="ok">{t('Reťazec hashov je neporušený.')}</Notice>;
  }
  if (chain.tampered) {
    return (
      <Notice tone="err">
        {t('Zásah do audit logu:')}{' '}
        {chain.altered.length > 0 && (
          <>
            {t('zmenené záznamy #')}
            {chain.altered.join(', #')}.{' '}
          </>
        )}
        {chain.missing_predecessor.length > 0 && (
          <>
            {t('Chýbajúci predchodca pri #')}
            {chain.missing_predecessor.join(', #')} {t('— záznam bol zmazaný.')}
          </>
        )}
      </Notice>
    );
  }
  return (
    <Notice tone="warn">
      {t('Žiadny záznam nebol zmenený ani zmazaný. Reťazec má')} {chain.forks.length}{' '}
      {t('rozvetvenie(a) pri #')}
      {chain.forks.join(', #')}
      {t(
        ': dva zápisy v tom istom okamihu nadviazali na rovnakého predchodcu. Zápis je odvtedy serializovaný; staré záznamy sa neprepisujú — log je len na pripisovanie.',
      )}
    </Notice>
  );
}
