// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  renewInvitation,
  revokeOrganization,
  selectOrganization,
  setOrganizationLifespan,
  setOrganizationSchemas,
  trustChain,
} from '../../shared/api/accreditation.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import Checkbox from '../../shared/ui/Checkbox.tsx';
import CheckboxGroup from '../../shared/ui/CheckboxGroup.tsx';
import CodeText from '../../shared/ui/CodeText.tsx';
import ConfirmDialog from '../../shared/ui/ConfirmDialog.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import Table from '../../shared/ui/Table.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { PLACE } from '../../shared/places.ts';
import { Revocation, RevokeRow } from './Revocation.tsx';
import { formatDate, formatDateTime as when, t } from '../../shared/i18n/index.ts';
import { inLang } from '../../shared/certificates/fields.ts';

/**
 * The trust chain below the RootTAO (design decisions D15).
 *
 * The RootTAO selects TAOs; a TAO selects TIs, the organizations that may
 * issue certificates. Selecting gives a one-time invitation, shown here once:
 * with it the organization registers its account - a TI in the wallet or here
 * on the sign-in page, a TAO here - and nobody registers without one.
 *
 * Selecting also says what the organization may attest (design decisions D17): the
 * RootTAO gives a TAO some of the certificate schemas it defined (Schémy), and
 * a TAO hands on some of its own to a TI. Either can change that later; a
 * schema taken from a TAO is taken from its TIs too.
 *
 * The one that selected an organization may revoke its accreditation, for good
 * (design decisions D24): the RootTAO a TAO's, a TAO a TI's. Unlike an end, it
 * withdraws everything: the organization and those it selected can no longer
 * sign in, and every certificate they issued is suspended at once and
 * proposed for revocation.
 */
/** How soon an end counts as near, in days: the TAO should renew by then. */
const ENDING_SOON_DAYS = 30;

/**
 * A date input's value, `days` from today.
 * @param days - Number of days from today.
 * @returns The local date-only default.
 */
function dateIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** A date input's value as the end of that day, local time, in ISO. */
const endOfDay = (value) => new Date(`${value}T23:59:59`).toISOString();

/**
 * New selections first; the id keeps the order deterministic for equal timestamps.
 * @param organizations - Organization rows returned by the existing hierarchy API.
 * @returns A reordered copy retaining the original organization rows.
 */
function newestFirst(organizations = []) {
  return [...organizations].sort((left, right) => {
    const bySelection = (Date.parse(right.selected_at) || 0) - (Date.parse(left.selected_at) || 0);
    return bySelection || right.organization_id.localeCompare(left.organization_id);
  });
}

/**
 * Why an accreditation end was refused, by the back-office's code (D23).
 * @param error - Caught failure from the existing backend, browser or contract operation.
 * @returns The existing operator-facing lifespan refusal.
 */
function lifespanError(error) {
  return (
    {
      LifespanRequired: t('TI sa vyberá s dátumom, do ktorého je akreditovaný.'),
      LifespanInvalid: t('Dátum konca akreditácie nie je platný.'),
      LifespanInPast: t('Akreditácia nemôže skončiť v minulosti — ukončiť ju môžete hneď.'),
      LifespanTooLong: t('Na tak dlho naraz akreditáciu udeliť nemožno (najviac {0} dní).', [
        error.payload?.codes?.[0] ?? '1826',
      ]),
      AlreadyEnded: t('Akreditácia už skončila.'),
      NotYours: t('Akreditáciu TI predlžuje alebo ukončuje TAO, ktorý ho vybral.'),
    }[error.reason] ?? error.message
  );
}

/**
 * Until when a TI may issue (D23). An end that has passed stops new
 * certificates only: those issued before it stay valid until their own end.
 * @param options - Existing component inputs: {row}.
 * @returns The rendered React content.
 */
function Accreditation(options) {
  const { row } = options;

  if (row.revoked) return <Revocation row={row} />;
  if (row.kind !== 'ti') return null;
  if (!row.accredited_until) {
    return <div className="small-muted mt-1">{t('akreditácia bez obmedzenia')}</div>;
  }
  const end = new Date(row.accredited_until);
  if (row.accreditation_ended) {
    return (
      <div className="mt-1">
        <Badge tone="rejected">{t('akreditácia skončila')}</Badge>
        <div className="small-muted mt-1">
          {when(row.accredited_until)} — {t('nové certifikáty nevydá; vydané predtým platia ďalej')}
        </div>
      </div>
    );
  }
  const days = Math.ceil((+end - +new Date()) / 86400000);
  return (
    <div className="small-muted mt-1">
      {days <= ENDING_SOON_DAYS ? (
        <Badge tone="pending">{t('akreditácia skončí o {0} dní', [days])}</Badge>
      ) : (
        <>
          {t('akreditácia platí do')} {formatDate(row.accredited_until)}
        </>
      )}
    </div>
  );
}

/**
 * Render the schemas available for delegation with their current selection.
 * @param options - Existing component inputs: {available, chosen, onChange, idPrefix}.
 * @returns The rendered React content.
 */
function SchemaChecks(options) {
  const { available, chosen, onChange, idPrefix } = options;

  if (available.length === 0) {
    return (
      <div className="small-muted-md">
        {t('Zatiaľ nemáte žiadnu schému, ktorú by ste mohli prideliť.')}
      </div>
    );
  }
  return (
    <CheckboxGroup>
      {available.map((schema) => (
        <Checkbox
          key={schema.credential_type}
          id={`${idPrefix}-${schema.credential_type}`}
          checked={chosen.includes(schema.credential_type)}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? [...chosen, schema.credential_type]
                : chosen.filter((type) => type !== schema.credential_type),
            )
          }
        >
          {inLang(schema.name)}
        </Checkbox>
      ))}
    </CheckboxGroup>
  );
}

/**
 * Render the schema names delegated to the selected organization.
 * @param options - Existing component inputs: {row, names}.
 * @returns The rendered React content.
 */
function Schemas(options) {
  const { row, names } = options;

  if (!row.schemas?.length) return <div className="small-muted mt-1">{t('bez schém')}</div>;
  return (
    <div className="tags">
      {row.schemas.map((type) => (
        <span key={type} className="tag">
          {names[type] ?? type}
        </span>
      ))}
    </div>
  );
}

/**
 * Render the selected organization registration and invitation state.
 * @param options - Existing component inputs: {row}.
 * @returns The rendered React content.
 */
function Status(options) {
  const { row } = options;

  if (row.account) {
    return (
      <>
        <Badge tone="approved">{t('registrovaná')}</Badge>
        <div className="small-muted mt-1">
          {t('účet')} <span className="mono">{row.account}</span>, {when(row.registered_at)}
        </div>
        {/* A TI issues under its own DID (D27). */}
        {row.did && (
          <div className="small-muted mt-1" title={row.did}>
            DID <span className="mono">{row.did}</span>
          </div>
        )}
        {row.kind === 'ti' && !row.is_issuer && (
          <div className="small-muted mt-1">
            {t('v EBSI zatiaľ nie je nastavená ako vydavateľ')}
          </div>
        )}
      </>
    );
  }
  const expired = row.invitation_expires_at && new Date(row.invitation_expires_at) <= new Date();
  return (
    <>
      <Badge tone={expired ? 'rejected' : 'pending'}>
        {expired ? t('pozvánka vypršala') : t('čaká na registráciu')}
      </Badge>
      {row.invitation_expires_at && !expired && (
        <div className="small-muted mt-1">
          {t('pozvánka platí do')} {when(row.invitation_expires_at)}
        </div>
      )}
    </>
  );
}

/**
 * Render the one-time invitation details returned by an organization operation.
 * @param options - Existing component inputs: {invitation, className = ''}.
 * @returns The rendered React content.
 */
function InvitationNotice(options) {
  const { invitation, className = '' } = options;

  return (
    <Notice className={className} tone="ok">
      {t('Pozvánka pre {0} ({1}):', [invitation.name, PLACE[invitation.kind]])}
      <CodeText className="code-emphasis">{invitation.code}</CodeText>
      {t('Platí do')} {when(invitation.until)}.{' '}
      {invitation.accreditedUntil && (
        <>{t('Akreditácia TI platí do {0}.', [formatDate(invitation.accreditedUntil)])} </>
      )}
      {invitation.kind === 'ti'
        ? t(
            'Odovzdajte ju organizácii; zobrazí sa len teraz. S ňou sa zaregistruje v aplikácii (Pre organizácie → Registrovať) alebo na prihlasovacej stránke tejto konzoly.',
          )
        : t(
            'Odovzdajte ju organizácii; zobrazí sa len teraz. S ňou sa zaregistruje na prihlasovacej stránke tejto konzoly.',
          )}
    </Notice>
  );
}

/**
 * Render the existing hierarchy, invitations, schema delegation and revocation workflows.
 * @returns The rendered React content.
 */
export default function AccreditationTab() {
  const [chain, setChain] = useState(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invitations, setInvitations] = useState({});
  const [renewing, setRenewing] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [openPanel, setOpenPanel] = useState(null);
  // A TI's accreditation end, being changed: {id, until} (D23).
  const [lifespan, setLifespan] = useState(null);
  const [lifespanSaving, setLifespanSaving] = useState(false);
  const [endingNow, setEndingNow] = useState(null);
  const [accreditedUntil, setAccreditedUntil] = useState(() => dateIn(365));
  // The organization whose accreditation is being revoked (D24), and what followed.
  const [revoking, setRevoking] = useState(null);
  const [revokedNotice, setRevokedNotice] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const loaded = await trustChain();
      setChain(loaded);
      // Offered all by default: what the selector holds is usually what it hands on.
      setChosen(
        (current) => current ?? loaded.available_schemas.map((schema) => schema.credential_type),
      );
    } catch (e) {
      setError(
        e.reason === 'NoOrganization'
          ? t('Tento účet nie je registrovaný za RootTAO ani TAO v reťazci dôvery.')
          : e.message,
      );
      setChain(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Submit the selected organization and delegated schemas and retain its one-time invitation.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function select(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await selectOrganization(
        name.trim(),
        contact.trim(),
        chosen ?? [],
        chain.selects === 'ti' ? endOfDay(accreditedUntil) : null,
      );
      setInvitations((current) => ({
        ...current,
        [data.organization_id]: {
          name: data.name,
          kind: data.kind,
          code: data.invitation,
          until: data.invitation_expires_at,
          accreditedUntil: data.accredited_until,
        },
      }));
      setEditing(null);
      setLifespan(null);
      setOpenPanel({ id: data.organization_id, type: 'invitation' });
      setName('');
      setContact('');
      setAccreditedUntil(dateIn(365));
      await load();
    } catch (e) {
      setError(
        e.payload?.fields?.includes('contact_email')
          ? t('Kontaktný e-mail nie je platný.')
          : lifespanError(e),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Submit the existing accreditation lifespan update and refresh the hierarchy.
   * @param change - Existing rule-change or accreditation-lifespan payload.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function saveLifespan(change) {
    setError('');
    setLifespanSaving(true);
    try {
      await setOrganizationLifespan(lifespan.id, change);
      setLifespan(null);
      setEndingNow(null);
      setOpenPanel(null);
      await load();
    } catch (e) {
      setEndingNow(null);
      setError(lifespanError(e));
    } finally {
      setLifespanSaving(false);
    }
  }

  /**
   * Renew the selected organization invitation and retain its returned one-time details.
   * @param row - Selected organization or certificate row returned by the existing API.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function renew(row) {
    setError('');
    setEditing(null);
    setLifespan(null);
    setOpenPanel({ id: row.organization_id, type: 'invitation' });
    setRenewing(row.organization_id);
    try {
      const data = await renewInvitation(row.organization_id);
      setInvitations((current) => ({
        ...current,
        [row.organization_id]: {
          name: row.name,
          kind: row.kind,
          code: data.invitation,
          until: data.invitation_expires_at,
        },
      }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRenewing(null);
    }
  }

  /**
   * Submit the confirmed organization revocation and refresh its visible branch.
   * @param row - Selected organization or certificate row returned by the existing API.
   * @param reason - Recorded revocation reason code.
   * @param note - Existing optional reason note.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function revoke(row, reason, note) {
    setError('');
    setRevokedNotice(null);
    try {
      const data = await revokeOrganization(row.organization_id, reason, note);
      setRevoking(null);
      setRevokedNotice({
        name: row.name,
        suspended: data.suspended ?? 0,
        proposed: data.revocations_proposed ?? 0,
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  /**
   * Submit the selected organization schema grants and refresh the hierarchy.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function saveSchemas() {
    setError('');
    try {
      await setOrganizationSchemas(editing.id, editing.schemas);
      setEditing(null);
      setOpenPanel(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const selects = chain?.selects;
  // Names of every schema this page may show: those it can hand on, and any
  // an organization below holds.
  const names = Object.fromEntries(
    (chain?.available_schemas ?? []).map((s) => [s.credential_type, inLang(s.name)]),
  );

  /**
   * Open schema editing with the selected organization current grants.
   * @param row - Selected organization or certificate row returned by the existing API.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function openSchemas(row) {
    setLifespan(null);
    setEditing({ id: row.organization_id, schemas: [...(row.schemas ?? [])] });
    setOpenPanel({ id: row.organization_id, type: 'schemas' });
  }

  /**
   * Open lifespan editing with the selected organization current accreditation date.
   * @param row - Selected organization or certificate row returned by the existing API.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function openLifespan(row) {
    setEditing(null);
    setLifespan({ id: row.organization_id, until: dateIn(365) });
    setOpenPanel({ id: row.organization_id, type: 'lifespan' });
  }

  return (
    <>
      <Panel title={t('Reťazec dôvery')}>
        {chain && (
          <p className="hint">
            {t('Ste')} <b>{PLACE[chain.organization.kind]}</b> — {chain.organization.name}.{' '}
            {selects === 'tao'
              ? t(
                  'Vyberáte TAO; každý TAO potom vyberá TI — organizácie, ktoré smú vydávať certifikáty.',
                )
              : t(
                  'Vyberáte TI — organizácie, ktoré smú vydávať certifikáty z aplikácie alebo z back-office.',
                )}
          </p>
        )}

        {error && <Notice tone="err">{error}</Notice>}

        {revokedNotice && (
          <Notice tone="ok">
            {t(
              'Akreditácia organizácie {0} bola odňatá. Pozastavených certifikátov: {1}; navrhnutých na odňatie: {2} — schváli ich druhá osoba v Životnom cykle.',
              [revokedNotice.name, revokedNotice.suspended, revokedNotice.proposed],
            )}
          </Notice>
        )}

        {chain && (
          <form className="accreditation-select-form" onSubmit={select}>
            <h3>{selects === 'tao' ? t('Vybrať TAO') : t('Vybrať TI')}</h3>
            <div className="grid">
              <Field id="org-name" label={t('Názov organizácie')}>
                <TextInput
                  id="org-name"
                  value={name}
                  placeholder={t('napr. Agentúra pre digitálne zručnosti')}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                />
              </Field>
              <Field id="org-contact" label={t('Kontaktný e-mail (voliteľné)')}>
                <TextInput
                  id="org-contact"
                  type="email"
                  value={contact}
                  placeholder={t('napr. kontakt@organizacia.sk')}
                  onChange={(e) => setContact(e.target.value)}
                />
              </Field>
              {selects === 'ti' && (
                <Field id="org-until" label={t('Akreditácia platí do')}>
                  <TextInput
                    id="org-until"
                    type="date"
                    min={dateIn(1)}
                    value={accreditedUntil}
                    placeholder={t('Vyberte dátum')}
                    onChange={(e) => setAccreditedUntil(e.target.value)}
                    required
                  />
                </Field>
              )}
            </div>
            <Field
              className="mt-3"
              label={
                selects === 'tao'
                  ? t('Schémy, ktoré TAO smie prideľovať')
                  : t('Schémy, ktoré TI smie vydávať')
              }
            >
              <SchemaChecks
                available={chain.available_schemas}
                chosen={chosen ?? []}
                onChange={setChosen}
                idPrefix="sel"
              />
            </Field>
            <FormActions className="mt-4">
              <Button
                type="submit"
                disabled={busy || !name.trim() || (selects === 'ti' && !accreditedUntil)}
              >
                {busy ? t('Vyberá sa…') : t('Vybrať a vytvoriť pozvánku')}
              </Button>
            </FormActions>
          </form>
        )}
      </Panel>

      {chain && (
        <Panel
          className="accreditation-list"
          title={selects === 'tao' ? t('Vybrané TAO a ich TI') : t('Vybrané TI')}
        >
          {chain.accredited.length === 0 ? (
            <Notice>{t('Zatiaľ nikto.')}</Notice>
          ) : (
            <Table className="accreditation-table" scroll={false} spaced>
              <colgroup>
                <col className="accreditation-column-organization" />
                <col className="accreditation-column-contact" />
                <col className="accreditation-column-selector" />
                <col className="accreditation-column-status" />
                <col className="accreditation-column-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('Organizácia')}</th>
                  <th>{t('Kontakt')}</th>
                  <th>{t('Vybral')}</th>
                  <th>{t('Stav')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {newestFirst(chain.accredited).map((row) => (
                  <Fragment key={row.organization_id}>
                    <tr className="accreditation-data-row">
                      <td>
                        <b>{row.name}</b> <span className="muted">{PLACE[row.kind]}</span>
                        <Schemas row={row} names={names} />
                      </td>
                      <td className="mono accreditation-contact">
                        <span
                          className="accreditation-cell-value"
                          title={row.contact_email || undefined}
                        >
                          {row.contact_email || '—'}
                        </span>
                      </td>
                      <td className="mono accreditation-selector">
                        <span
                          className="accreditation-cell-value"
                          title={row.selected_by ?? undefined}
                        >
                          {row.selected_by ?? '—'}
                        </span>
                      </td>
                      <td className="accreditation-status">
                        <Status row={row} />
                        <Accreditation row={row} />
                      </td>
                      <td>
                        <div className="accreditation-action-buttons">
                          {/* A revoked organization is never changed again (D24). */}
                          {!row.revoked && (
                            <>
                              {row.kind === 'ti' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-expanded={
                                    openPanel?.id === row.organization_id &&
                                    openPanel.type === 'lifespan'
                                  }
                                  onClick={() => openLifespan(row)}
                                >
                                  {t('Akreditácia')}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-expanded={
                                  openPanel?.id === row.organization_id &&
                                  openPanel.type === 'schemas'
                                }
                                onClick={() => openSchemas(row)}
                              >
                                {t('Schémy')}
                              </Button>
                              {!row.account && (
                                <Button
                                  className="accreditation-invite-button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={renewing === row.organization_id}
                                  aria-busy={renewing === row.organization_id}
                                  aria-expanded={
                                    openPanel?.id === row.organization_id &&
                                    openPanel.type === 'invitation'
                                  }
                                  onClick={() => renew(row)}
                                >
                                  {t('Nová pozvánka')}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="danger"
                                onClick={() => setRevoking(row.organization_id)}
                              >
                                {t('Odňať')}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!row.account &&
                      !row.revoked &&
                      invitations[row.organization_id] &&
                      openPanel?.id === row.organization_id &&
                      openPanel.type === 'invitation' && (
                        <tr>
                          <td colSpan={5}>
                            <InvitationNotice
                              className="accreditation-inline-invitation"
                              invitation={invitations[row.organization_id]}
                            />
                          </td>
                        </tr>
                      )}
                    {editing?.id === row.organization_id &&
                      openPanel?.id === row.organization_id &&
                      openPanel.type === 'schemas' && (
                        <tr>
                          <td colSpan={5}>
                            <Field label={t('Schémy pre {0}', [row.name])}>
                              <SchemaChecks
                                available={chain.available_schemas}
                                chosen={editing.schemas}
                                onChange={(schemas) => setEditing({ ...editing, schemas })}
                                idPrefix={`ed-${row.organization_id}`}
                              />
                            </Field>
                            {row.kind === 'tao' && (
                              <div className="small-muted-md accreditation-schema-note">
                                {t('Schéma odobratá TAO sa odoberie aj jeho TI.')}
                              </div>
                            )}
                            <FormActions>
                              <Button size="sm" onClick={saveSchemas}>
                                {t('Uložiť schémy')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(null);
                                  setOpenPanel(null);
                                }}
                              >
                                {t('Zrušiť')}
                              </Button>
                            </FormActions>
                          </td>
                        </tr>
                      )}
                    {lifespan?.id === row.organization_id &&
                      openPanel?.id === row.organization_id &&
                      openPanel.type === 'lifespan' && (
                        <tr>
                          <td colSpan={5}>
                            <Field
                              id={`until-${row.organization_id}`}
                              label={t('Nový koniec akreditácie pre {0}', [row.name])}
                            >
                              <TextInput
                                id={`until-${row.organization_id}`}
                                type="date"
                                min={dateIn(1)}
                                value={lifespan.until}
                                placeholder={t('Vyberte dátum')}
                                onChange={(e) =>
                                  setLifespan({ ...lifespan, until: e.target.value })
                                }
                              />
                            </Field>
                            <div className="small-muted-md accreditation-lifespan-note">
                              {t(
                                'Predĺžiť, skrátiť alebo po skončení obnoviť. Certifikáty, ktoré TI vydal počas akreditácie, platia do konca svojej platnosti bez ohľadu na to, kedy akreditácia skončí.',
                              )}
                            </div>
                            <FormActions>
                              <Button
                                size="sm"
                                disabled={!lifespan.until || lifespanSaving}
                                onClick={() =>
                                  saveLifespan({ accredited_until: endOfDay(lifespan.until) })
                                }
                              >
                                {t('Uložiť dátum')}
                              </Button>
                              {!row.accreditation_ended && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="danger"
                                  disabled={lifespanSaving}
                                  onClick={() => setEndingNow(row.name)}
                                >
                                  {t('Ukončiť teraz')}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={lifespanSaving}
                                onClick={() => {
                                  setLifespan(null);
                                  setOpenPanel(null);
                                }}
                              >
                                {t('Zrušiť')}
                              </Button>
                            </FormActions>
                          </td>
                        </tr>
                      )}
                    {revoking === row.organization_id && (
                      <RevokeRow
                        row={row}
                        onRevoke={(reason, note) => revoke(row, reason, note)}
                        onCancel={() => setRevoking(null)}
                      />
                    )}
                    {newestFirst(row.accredited).map((child) => (
                      <tr className="accreditation-data-row" key={child.organization_id}>
                        <td className="cell-indent">
                          ↳ {child.name} <span className="muted">{PLACE[child.kind]}</span>
                          <Schemas row={child} names={names} />
                        </td>
                        <td className="mono accreditation-contact">
                          <span
                            className="accreditation-cell-value"
                            title={child.contact_email || undefined}
                          >
                            {child.contact_email || '—'}
                          </span>
                        </td>
                        <td className="mono accreditation-selector">
                          <span
                            className="accreditation-cell-value"
                            title={child.selected_by ?? undefined}
                          >
                            {child.selected_by ?? '—'}
                          </span>
                        </td>
                        <td className="accreditation-status">
                          <Status row={child} />
                          <Accreditation row={child} />
                        </td>
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
          <p className="footnote">
            {t(
              'Každý výber, zmena schém, nová pozvánka aj registrácia sa zapíše do auditného záznamu. Pozvánka je jednorazová; register uchováva len jej odtlačok. Každá TI vydáva pod vlastným DID a vlastnými kľúčmi, stav jej certifikátov vedie kontrakt riadenia; v EBSI ju akredituje TAO, ktorý ju vybral.',
            )}{' '}
            {t(
              'Akreditácia TI má koniec, ktorý určuje jeho TAO a môže ho predĺžiť alebo akreditáciu ukončiť. Po konci TI nevydá nový certifikát; tie, ktoré vydal počas akreditácie, ostávajú platné do konca svojej platnosti (design decisions D23).',
            )}{' '}
            {t(
              'Odňatie akreditácie je iné: je natrvalo, účty organizácie (a pri TAO aj jeho TI) sa už neprihlásia a všetky ich certifikáty sa stiahnu — hneď sa pozastavia a navrhnú na odňatie (design decisions D24).',
            )}
          </p>
        </Panel>
      )}
      <ConfirmDialog
        open={Boolean(endingNow)}
        title={t('Ukončiť akreditáciu pre {0}?', [endingNow ?? ''])}
        confirmLabel={lifespanSaving ? t('Ukončuje sa…') : t('Ukončiť akreditáciu')}
        cancelLabel={t('Zrušiť')}
        busy={lifespanSaving}
        danger
        onCancel={() => setEndingNow(null)}
        onConfirm={() => saveLifespan({ end_now: true })}
      >
        <p>{t('Organizácia okamžite stratí možnosť vydávať nové certifikáty.')}</p>
        <p className="muted">
          {t(
            'Už vydané certifikáty zostanú platné do konca svojej platnosti. Akreditáciu môžete neskôr obnoviť novým dátumom.',
          )}
        </p>
      </ConfirmDialog>
    </>
  );
}
