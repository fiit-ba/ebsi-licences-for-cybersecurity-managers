// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useEffect, useState } from 'react';
import { certificateScheme, issueCertificate } from '../../shared/api/certificates.ts';
import Button from '../../shared/ui/Button.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import KeyValue from '../../shared/ui/KeyValue.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import OfferPanel from '../../shared/ui/OfferPanel.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import SelectField from '../../shared/ui/SelectField.tsx';
import Table from '../../shared/ui/Table.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import { formatDate, t } from '../../shared/i18n/index.ts';
import { SECTIONS, fieldHint, fieldLabel, inLang } from '../../shared/certificates/fields.ts';

/** How soon a TI is told its accreditation is about to end, in days (D23). */
const ENDING_SOON_DAYS = 30;

/**
 * Until when this TI may issue (design decisions D23). After the end the form
 * stays to look at, but issuing stops; what was issued before stays valid.
 * @param options - Existing component inputs: {until, ended}.
 * @returns The rendered React content.
 */
function AccreditationNotice(options) {
  const { until, ended } = options;

  if (!until) return null;
  if (ended) {
    return (
      <Notice tone="err">
        {t(
          'Akreditácia vašej organizácie skončila {0}. Nové certifikáty vydávať nemôžete; certifikáty, ktoré ste vydali počas akreditácie, ostávajú platné do konca svojej platnosti. Obnovenie udeľuje váš TAO.',
          [formatDate(until)],
        )}
      </Notice>
    );
  }
  const days = Math.ceil((+new Date(until) - +new Date()) / 86400000);
  if (days <= ENDING_SOON_DAYS) {
    return (
      <Notice tone="warn">
        {t(
          'Akreditácia vašej organizácie skončí {0} (o {1} dní). O predĺženie požiadajte svoj TAO.',
          [formatDate(until), days],
        )}
      </Notice>
    );
  }
  return (
    <p className="hint">{t('Akreditácia vašej organizácie platí do {0}.', [formatDate(until)])}</p>
  );
}

/**
 * Issue a certificate.
 *
 * One request does the whole thing: the certificate is registered with the
 * attributes the certification body supplies, under the number it gives it -
 * once per TI - and an OpenID4VCI 1.0 offer comes back whose pre-authorized code
 * redeems this certificate and no other. Its record on the certificate registry is
 * written when the holder collects it, under a key from the TI's DID and the
 * collected credential's id.
 *
 * The attributes matter. A credential with an empty `credentialSubject` says
 * nothing about the holder's competence, and two of them are indistinguishable
 * in a wallet — which is exactly what happened before the registry became the
 * Authentic for its own certificates.
 *
 * Which attributes, and which of them are required, is the certificate schema
 * (design decisions D16, D17): the RootTAO defines schemas, the TI's TAO decides
 * which of them it may issue, and the form is built from the one chosen. The
 * certification body is the signed-in TI's own name, not typed in.
 */
/**
 * Today in the operator's time zone, as the date input writes it (YYYY-MM-DD).
 * @returns The current local date string.
 */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A schema's starting values: its defaults, the TI's own name.
 * @param schema - Selected certificate schema and its current version.
 * @param organization - Existing issuing organization name.
 * @returns Claim defaults keyed by field identifier, using the TI name for organization fields.
 */
function initial(schema, organization) {
  return Object.fromEntries(
    schema.fields.map((field) => [
      field.key,
      field.organization && organization ? organization : field.default,
    ]),
  );
}

/**
 * Render schema-driven issuance and the one-time holder offer.
 * @returns The rendered React content.
 */
export default function IssueTab() {
  const [available, setAvailable] = useState(null);
  const [scheme, setScheme] = useState(null);
  const [holderReference, setHolderReference] = useState('');
  const [claims, setClaims] = useState({});
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState({ missing: [], invalid: [] });
  // Set when the back-office refuses because the accreditation ended (D23).
  const [ended, setEnded] = useState(false);
  const accreditationEnded = ended || Boolean(available?.accreditation_ended);

  useEffect(() => {
    let alive = true;
    certificateScheme()
      .then((data) => {
        if (!alive) return;
        setAvailable(data);
        const first = data.schemas?.[0];
        if (first) choose(first, data.organization);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Select the issuance schema and initialize its existing organization-dependent defaults.
   * @param schema - Selected certificate schema and its current version.
   * @param organization - Existing issuing organization name.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function choose(schema, organization = available?.organization) {
    if (!schema) return;
    setScheme({ ...schema, organization });
    setClaims(initial(schema, organization));
    setProblems({ missing: [], invalid: [] });
  }

  const set = (key, value) => setClaims((current) => ({ ...current, [key]: value }));

  /**
   * Clear the issuance input values using the currently selected schema defaults.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  function blank() {
    setHolderReference('');
    setClaims(initial(scheme, scheme.organization));
    setValidUntil('');
  }

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function submit(event) {
    event.preventDefault();
    if (!scheme) return;
    setBusy(true);
    setError('');
    setProblems({ missing: [], invalid: [] });
    setResult(null);
    try {
      const payload: {
        credential_type: string;
        holder_reference: string;
        claims: Record<string, unknown>;
        valid_until?: string;
      } = {
        credential_type: scheme.credential_type,
        holder_reference: holderReference.trim(),
        claims: Object.fromEntries(
          Object.entries(claims)
            .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
            .filter(([, value]) => value !== ''),
        ),
      };
      if (validUntil) {
        // A certificate valid "until" a day is valid through that day. The
        // bare date parsed as midnight UTC, so choosing today produced a
        // certificate that had already expired.
        if (validUntil < today()) {
          throw new Error(
            t('Platnosť do nemôže byť v minulosti — certifikát by sa nedal vyzdvihnúť.'),
          );
        }
        payload.valid_until = new Date(`${validUntil}T23:59:59`).toISOString();
      }
      const data = await issueCertificate(payload);
      setResult(data);
      blank();
    } catch (e) {
      if (e.reason === 'InvalidClaims') {
        setProblems({ missing: e.payload?.missing ?? [], invalid: e.payload?.invalid ?? [] });
        setError(t('Certifikát nezodpovedá schéme. Skontrolujte vyznačené polia.'));
      } else if (e.reason === 'NotATI') {
        setError(
          t('Vydávať môže len TI, ktorú vybral TAO. Tento účet nie je TI v reťazci dôvery.'),
        );
      } else if (e.reason === 'SchemaNotAccredited') {
        setError(
          t('Vaša TI nie je akreditovaná na vydávanie tejto schémy. Pridelí vám ju váš TAO.'),
        );
      } else if (
        e.reason === 'CertificateNumberTaken' ||
        e.reason === 'CertificateNumberRequired'
      ) {
        setProblems({ missing: e.payload?.missing ?? [], invalid: e.payload?.invalid ?? [] });
        setError(
          e.reason === 'CertificateNumberTaken'
            ? t('Certifikát s týmto číslom ste už vydali. Každý certifikát TI má vlastné číslo.')
            : t('Certifikát potrebuje číslo.'),
        );
      } else if (e.reason === 'AccreditationExpired') {
        setEnded(true);
        setAvailable(
          (current) =>
            current && {
              ...current,
              accredited_until: e.payload?.accredited_until ?? current.accredited_until,
            },
        );
        setError('');
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        as="form"
        className="issue-panel"
        hint={t(
          'Zaregistruje certifikát s jeho atribútmi pod číslom, ktoré mu TI dáva — každé číslo raz — a vráti ponuku OpenID4VCI pre peňaženku držiteľa (komponent 5). Keď si ho držiteľ vyzdvihne, zapíše sa do registra certifikátov.',
        )}
        title={t('Vydať certifikát')}
        onSubmit={submit}
      >
        {!available && !error && (
          <div className="issue-placeholder" aria-label={t('Načítava sa…')}>
            <div className="grid">
              <span />
              <span />
            </div>
            <h3>{t('Držiteľ')}</h3>
            <div className="grid">
              <span />
              <span />
            </div>
            <h3>{t('Školenie')}</h3>
            <div className="grid">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <h3>{t('Osvedčenie')}</h3>
            <div className="grid">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {available && (
          <AccreditationNotice until={available.accredited_until} ended={accreditationEnded} />
        )}
        {available && available.schemas.length === 0 && (
          <Notice>
            {t(
              'Vaša organizácia zatiaľ nesmie vydávať žiadnu schému certifikátu. Pridelí vám ju váš TAO v back-office.',
            )}
          </Notice>
        )}
        {available && available.schemas.length > 1 && (
          <SelectField
            fieldClassName="mb-3"
            id="schema"
            label={t('Druh certifikátu')}
            value={scheme?.credential_type ?? ''}
            onChange={(e) =>
              choose(available.schemas.find((s) => s.credential_type === e.target.value))
            }
          >
            {available.schemas.map((schema) => (
              <option key={schema.credential_type} value={schema.credential_type}>
                {inLang(schema.name)} ({t('verzia {0}', [schema.version])})
              </option>
            ))}
          </SelectField>
        )}

        {scheme && (
          <div className="grid">
            <Field id="href" label={t('Interná referencia držiteľa')}>
              <TextInput
                id="href"
                value={holderReference}
                onChange={(e) => setHolderReference(e.target.value)}
                placeholder={t('napr. spis-2026-0001')}
                required
              />
            </Field>
            <Field id="vu" label={t('Platnosť do (voliteľné)')}>
              <TextInput
                id="vu"
                type="date"
                min={today()}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                placeholder={t('Vyberte dátum')}
              />
            </Field>
          </div>
        )}

        {scheme &&
          Object.entries(SECTIONS)
            .filter(([section]) => scheme.fields.some((f) => f.section === section))
            .map(([section, title]) => (
              <Fragment key={section}>
                <h3>{t(title)}</h3>
                <div className="grid">
                  {scheme.fields
                    .filter((field) => field.section === section)
                    .map((field) => {
                      const fixed = field.organization && scheme.organization;
                      const wrong =
                        problems.missing.includes(field.key) ||
                        problems.invalid.includes(field.key);
                      return (
                        <Field
                          key={field.key}
                          id={`c-${field.key}`}
                          label={`${fieldLabel(field.key, field)}${field.required || field.organization ? '' : ` ${t('(voliteľné)')}`}`}
                        >
                          <TextInput
                            id={`c-${field.key}`}
                            type={
                              field.kind === 'date'
                                ? 'date'
                                : field.kind === 'integer'
                                  ? 'number'
                                  : 'text'
                            }
                            min={field.kind === 'integer' ? 1 : undefined}
                            value={claims[field.key] ?? ''}
                            onChange={(e) => set(field.key, e.target.value)}
                            placeholder={
                              field.kind === 'date'
                                ? t('Vyberte dátum')
                                : fieldHint(field.key, field)
                            }
                            required={field.required}
                            readOnly={Boolean(fixed)}
                            invalid={wrong}
                          />
                        </Field>
                      );
                    })}
                </div>
              </Fragment>
            ))}

        <p className="footnote">
          {t(
            'Referencia držiteľa je pseudonymný kľúč do internej evidencie — nikdy nie meno a nikdy nie DID držiteľa (komponent 1.2). Atribúty sa uložia šifrovane a stanú sa z nich',
          )}{' '}
          <code>credentialSubject</code>
          {t('; DID držiteľa doplní Issuer Service až pri uplatnení ponuky. Stav')}{' '}
          <code>EXPIRED</code> {t('sa odvodzuje z')} <code>validUntil</code>{' '}
          {t('a záznam v registri certifikátov ho uvádza (komponent 1.1).')}
        </p>

        <FormActions>
          <Button disabled={!scheme || busy || accreditationEnded} type="submit">
            {busy ? t('Vydáva sa…') : t('Vydať certifikát')}
          </Button>
        </FormActions>

        {error && <Notice tone="err">{error}</Notice>}
      </Panel>

      {result && <OfferPanel offer={result} />}

      {result && (
        <Panel
          hint={t(
            'Jediný zdroj pravdy o certifikáte: jeho záznam v registri certifikátov — TI, platnosť, odtlačok licencie a stav. Overovateľ ho nájde z licencie, ktorú mu držiteľ ukáže, bez back-office.',
          )}
          title={t('Záznam v registri certifikátov')}
        >
          <KeyValue>
            <dt>{t('DID TI')}</dt>
            <dd className="mono">{result.issuer_did}</dd>
            <dt>{t('Číslo certifikátu')}</dt>
            <dd>{result.certificate_number}</dd>
          </KeyValue>
          <Notice>
            {t(
              'Záznam vznikne, keď si držiteľ licenciu vyzdvihne — pod kľúčom z DID TI a identifikátora vyzdvihnutej licencie. Jeho stav potom ukazuje Životný cyklus a audítor ho overí v záložke Audit.',
            )}
          </Notice>
        </Panel>
      )}
    </>
  );
}
