// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { Fragment, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { listSchemas } from '../../shared/api/schemas.ts';
import { presentationOffer, presentationResult } from '../../shared/api/verification.ts';
import { PLACE } from '../../shared/places.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import CodeText from '../../shared/ui/CodeText.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import KeyValue from '../../shared/ui/KeyValue.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Panel from '../../shared/ui/Panel.tsx';
import Table from '../../shared/ui/Table.tsx';
import { formatDateTime as when, serverMessage, t } from '../../shared/i18n/index.ts';
import {
  fieldLabel,
  fieldValue,
  inFieldOrder,
  learnLabels,
} from '../../shared/certificates/fields.ts';
import ScanHolder from './ScanHolder.tsx';

/**
 * Ask a holder to present a certificate (component 6).
 *
 * The console plays the verifier: it mints a presentation request, shows it as
 * a QR, and waits for the outcome. The wallet answers the issuer's
 * `direct_post` endpoint, not this page, so the result is correlated by the
 * request's `state`.
 *
 * The answer is the state the specification defines (6), the 6.3 conjunction
 * condition by condition, and per certificate what the state rests on: its
 * attributes as presented, validity, the issuer and the key that signed, the
 * accreditation chain in the TIR, the TSR schemas and its record on the
 * governance contract, the only status it has (D34, D36).
 *
 * Or the other way round: the holder shows a QR code from the wallet, and the
 * console connects to the wallet behind it (ScanHolder, D35).
 * @returns The rendered React content.
 */
export default function VerifyTab() {
  const [offer, setOffer] = useState(null);
  const [qr, setQr] = useState('');
  const [result, setResult] = useState(null);
  // Which panel asked: the console's own request, or the holder's QR code.
  const [source, setSource] = useState('request');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle');
  const timer = useRef(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  // Set on every mount, not only by useRef: React's StrictMode unmounts and
  // remounts each component once in development, and a ref left false then
  // made every request look stale - the QR was never drawn, nothing polled.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      clearTimeout(timer.current);
    };
  }, []);

  // The words the RootTAO gave each attribute (D17), so a certificate of any
  // schema reads in the console's language. Without them, identifiers.
  useEffect(() => {
    listSchemas()
      .then((data) => learnLabels(data.schemas))
      .catch(() => {});
  }, []);

  /**
   * Bound an existing asynchronous operation and always clear its timeout timer.
   * @param promise - Existing asynchronous operation subject to the timeout.
   * @param message - Existing backend message or timeout explanation.
   * @param timeoutMs - Existing request timeout in milliseconds.
   * @returns The original operation result if it settles before the existing timeout.
   */
  function withTimeout(promise, message, timeoutMs) {
    let timeout;
    const timerPromise = new Promise((_, reject) => {
      timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timerPromise]).finally(() => window.clearTimeout(timeout));
  }

  /**
   * Create the current presentation request and start its existing bounded polling lifecycle.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function start() {
    clearTimeout(timer.current);
    const request = requestRef.current + 1;
    requestRef.current = request;
    const fresh = () => mountedRef.current && request === requestRef.current;

    setError('');
    setResult(null);
    setSource('request');
    setOffer(null);
    setQr('');
    setPhase('creating');
    try {
      const data = await withTimeout(
        presentationOffer(),
        t(
          'Žiadosť o predloženie sa nepodarilo vytvoriť včas. Skontrolujte backend a skúste to znova.',
        ),
        30000,
      );
      if (!fresh()) return;
      setOffer(data);
      const qrData = await withTimeout(
        QRCode.toDataURL(data.offer_uri, { width: 320, margin: 1 }),
        t('QR kód sa nepodarilo pripraviť. Skúste vytvoriť novú žiadosť.'),
        5000,
      );
      if (!fresh()) return;
      setQr(qrData);
      setPhase('polling');

      // One request at a time: an answer may take a while to come (a slow
      // connection), and the next question waits for it rather than piling up.
      const poll = async () => {
        if (!fresh()) return;
        try {
          const outcome = await presentationResult(data.state);
          if (!fresh()) return;
          if (outcome.status === 'done') {
            setResult(outcome);
            setPhase('done');
            return;
          }
          // The holder declined in the wallet (OpenID4VP access_denied), or no answer came
          // before the request expired: stop waiting and say which.
          if (outcome.status === 'declined' || outcome.status === 'expired') {
            setError(
              outcome.status === 'declined'
                ? t('Držiteľ žiadosť v peňaženke odmietol.')
                : t('Žiadosť vypršala bez odpovede. Vytvorte novú.'),
            );
            // The request is over: its QR code must not invite another scan.
            setQr('');
            setPhase('idle');
            return;
          }
          timer.current = setTimeout(poll, 2000);
        } catch (e) {
          if (!fresh()) return;
          setError(e.message);
          setPhase('idle');
        }
      };
      timer.current = setTimeout(poll, 2000);
    } catch (e) {
      if (fresh()) {
        setError(e.message);
        setPhase('idle');
      }
    }
  }

  const creating = phase === 'creating';
  const waiting = phase === 'polling';

  return (
    <>
      <Panel
        hint={
          <>
            {t(
              'Vytvorí žiadosť o predloženie a čaká, kým ju držiteľ v peňaženke potvrdí. Peňaženka odpovedá vydavateľovi, nie tejto stránke, takže výsledok sa páruje cez',
            )}{' '}
            <code>state</code> {t('žiadosti.')}
          </>
        }
        title={t('Overiť certifikát')}
      >
        <FormActions>
          <Button disabled={creating} onClick={start}>
            {creating
              ? t('Vytvára sa žiadosť…')
              : offer && !result
                ? t('Nová žiadosť')
                : t('Požiadať o predloženie')}
          </Button>
        </FormActions>

        {error && <Notice tone="err">{error}</Notice>}
        {creating && <Notice>{t('Vytvára sa QR žiadosť…')}</Notice>}

        {qr && (
          <>
            <img
              src={qr}
              alt={t('QR kód so žiadosťou o predloženie')}
              width={320}
              height={320}
              className="qr-preview"
            />
            <KeyValue>
              <dt>state</dt>
              <dd className="mono">{offer.state}</dd>
            </KeyValue>
          </>
        )}

        {offer && waiting && !result && !error && <Notice>{t('Čaká sa na držiteľa…')}</Notice>}

        {result && source === 'request' && <Outcome result={result} />}
      </Panel>

      <ScanHolder
        onStart={() => {
          // The console's own request gives way: one presentation at a time.
          requestRef.current += 1;
          clearTimeout(timer.current);
          setOffer(null);
          setQr('');
          setError('');
          setPhase('idle');
          setResult(null);
          setSource('holder');
        }}
        onResult={setResult}
      >
        {result && source === 'holder' && <Outcome result={result} />}
      </ScanHolder>

      {result &&
        (result.credentials || []).map((credential, i) => (
          <CredentialEvidence
            key={i}
            credential={credential}
            index={i}
            count={result.credentials.length}
            attributesUntil={result.attributes_until}
          />
        ))}

      <Panel title={t('Ako to skúsiť')}>
        <p className="hint mb-0">
          {t('V peňaženke')} <b>{t('nestačí')}</b>{' '}
          {t(
            'otvoriť kartu „Prezentácie" — tá je len zoznamom už vykonaných predložení a pri našom toku ostáva prázdna. Predkladá sa naskenovaním tejto žiadosti tlačidlom',
          )}{' '}
          <b>{t('Skenovať')}</b> {t('na karte „Licencie".')}
        </p>
        <p className="hint mb-0 mt-2">
          {t('Opačným smerom: držiteľ na karte „Licencie" stlačí')}{' '}
          <b>{t('Preukázať sa overovateľovi')}</b>
          {t(
            ' a QR kód zo svojho telefónu ukáže kamere počítača alebo pošle jeho fotografiu. Telefón a back-office musia byť v rovnakej sieti.',
          )}
        </p>
      </Panel>
    </>
  );
}

// --- the answer (component 6) ---------------------------------------------

/**
 * The output states of component 6, and what each tells a relying party.
 * @returns The existing outcome-code display catalog.
 */
function outcomeStates() {
  return {
    VALID: { tone: 'ok', text: t('Certifikát je platný: všetky podmienky 6.3 sú splnené.') },
    SUSPENDED: {
      tone: 'warn',
      text: t(
        'Certifikát je pozastavený. Pozastavenie je vratné, no kým trvá, osvedčenie neplatí.',
      ),
    },
    REVOKED: { tone: 'err', text: t('Certifikát bol odňatý. Odňatie je trvalé.') },
    EXPIRED: { tone: 'err', text: t('Platnosť certifikátu uplynula (validUntil).') },
    NOT_YET_VALID: { tone: 'warn', text: t('Certifikát ešte nenadobudol platnosť (validFrom).') },
    UNTRUSTED_ISSUER: {
      tone: 'err',
      text: t('Vydavateľ nie je dôveryhodný: chýba alebo neplatí akreditačný reťazec v TIR.'),
    },
    INVALID_SIGNATURE: {
      tone: 'err',
      text: t('Podpis certifikátu nie je platný alebo kľúč nepatrí vydavateľovi.'),
    },
    STATUS_UNAVAILABLE: {
      tone: 'err',
      text: t(
        'Stav sa nedá s istotou určiť: kontrakt riadenia certifikát ešte nemá zapísaný alebo sa nedá prečítať. Nikdy to neznamená „platný“.',
      ),
    },
    INDETERMINATE: { tone: 'err', text: t('Overenie nemožno dokončiť. Výsledok nie je „platný“.') },
  };
}

/**
 * Component 6.3, condition by condition, in the specification's words.
 * @returns The existing verification-condition display catalog.
 */
function conditions() {
  return [
    ['presentation_valid', t('VP je platná (nonce, audience, ochrana proti replay)')],
    ['signature_valid', t('podpis VC je platný')],
    ['issuer_key_valid', t('issuer DID je rozlíšiteľný a kľúč platný')],
    ['disclosures_valid', t('zdieľané údaje zodpovedajú tomu, čo vydavateľ podpísal')],
    ['issuer_accredited', t('akreditácia issuera je platná pre daný typ credentialu')],
    ['schemas_valid', t('credential zodpovedá obom schémam')],
    ['time_valid', t('časová platnosť VC je splnená')],
    ['holder_bound', t('holder binding je overený')],
    ['status_available', t('záznam certifikátu v kontrakte riadenia je dostupný')],
    ['record_matches', t('záznam v kontrakte patrí tomuto certifikátu (TI, číslo, id, platnosť)')],
    ['standing_valid', t('kontrakt vedie certifikát ako platný')],
  ];
}

/**
 * A certificate's standing on the governance contract (D30), as words and a tone.
 * @param standing - Existing certificate standing code.
 * @returns The localized standing text.
 */
function standingText(standing) {
  return (
    { valid: t('platný'), suspended: t('pozastavený'), revoked: t('odňatý') }[standing] ??
    t('bez záznamu')
  );
}

/**
 * Resolve the ledger certificate standing to its existing status-badge tone.
 * @param standing - Existing certificate standing code.
 * @returns The existing status tone.
 */
function standingTone(standing) {
  return (
    { valid: 'VALID', suspended: 'SUSPENDED', revoked: 'REVOKED' }[standing] ?? 'INDETERMINATE'
  );
}

/**
 * Resolve an accreditation role to its existing operator-facing label.
 * @param role - Existing signer role identifier.
 * @returns The existing localized accreditation role.
 */
function roleLabel(role) {
  return (
    { TI: t('TI (vydavateľ)'), TAO: 'TAO', RootTAO: 'RootTAO', root: t('dôveryhodný koreň') }[
      role
    ] ?? role
  );
}

/**
 * Render the existing passed, failed or unevaluated verification-condition mark.
 * @param options - Existing component inputs: {value}.
 * @returns The rendered React content.
 */
function Mark(options) {
  const { value } = options;

  if (value === true) return <Badge tone="VALID">✓</Badge>;
  if (value === false) return <Badge tone="REVOKED">✗</Badge>;
  return (
    <span
      className="muted"
      title={t('Nevyhodnotené — overenie sa zastavilo skôr, alebo sa podmienka netýka')}
    >
      —
    </span>
  );
}

/**
 * Render the existing presentation outcome and its verification-condition evidence.
 * @param options - Existing component inputs: {result}.
 * @returns The rendered React content.
 */
export function Outcome(options) {
  const { result } = options;

  const states = outcomeStates();
  const state = states[result.outcome] ?? states.INDETERMINATE;
  const checks = result.checks || {};
  return (
    <>
      <Notice tone={state.tone} className="mt-3">
        <b>{result.outcome}</b> — {state.text}
        {result.detail && <CodeText className="mt-1">{serverMessage(result.detail)}</CodeText>}
      </Notice>
      <KeyValue className="mt-2">
        <dt>{t('Overené')}</dt>
        <dd>{when(result.created_at)}</dd>
        <dt>{t('Prijateľné')}</dt>
        <dd>{result.verified ? t('áno') : t('nie')}</dd>
        <dt>{t('Typy')}</dt>
        <dd>{(result.credential_types || []).join(', ') || '—'}</dd>
      </KeyValue>

      <h2 className="mt-4">{t('Podmienky platnosti (6.3)')}</h2>
      <p className="hint">
        {t(
          'Pre certifikát, ktorý rozhodol. Výsledok je VALID, len ak platia všetky; „—“ znamená, že sa overenie k podmienke nedostalo.',
        )}
      </p>
      <Table scroll={false}>
        <tbody>
          {conditions().map(([key, label]) => (
            <tr key={key}>
              <td className="cell-mark">
                <Mark value={checks[key]} />
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="footnote">
        {t(
          'Z prezentácie sa nikdy neukladá samotná prezentácia ani DID držiteľa (komponent 1.2). Údaje certifikátu sa ukážu len na krátky čas a potom sa zmažú; výsledok a dôkazy k nemu zostávajú.',
        )}
      </p>
    </>
  );
}

/**
 * The TI behind one of the registry's own certificates (design decisions D23),
 * judged at the moment it issued, never now: an accreditation that ended later
 * leaves the certificate valid, and is only shown.
 * @param options - Existing component inputs: {body}.
 * @returns The rendered React content.
 */
function CertificationBody(options) {
  const { body } = options;

  if (!body) return null;
  return (
    <>
      <h3>{t('Certifikačný orgán (TI)')}</h3>
      {body.recorded === false ? (
        <p className="hint">
          {t(
            'Nezistený — certifikát bol vydaný pred evidenciou TI, jeho akreditácia sa preto neposudzuje.',
          )}
        </p>
      ) : (
        <KeyValue>
          <dt>{t('Organizácia')}</dt>
          <dd>{body.name}</dd>
          <dt>{t('Vydal')}</dt>
          <dd>{when(body.issued_at)}</dd>
          <dt>{t('Akreditácia pri vydaní')}</dt>
          <dd>
            {body.accredited_at_issuance ? t('platila') : t('neplatila')}
            {' — '}
            {body.accredited_until_at_issuance
              ? t('do {0}', [when(body.accredited_until_at_issuance)])
              : t('bez obmedzenia')}
          </dd>
          {/* A revocation withdraws what the TI issued (D24); an end does not (D23). */}
          {body.revoked_at ? (
            <>
              <dt>{t('Dnes')}</dt>
              <dd>
                {t(
                  'akreditácia {0} ({1}) bola odňatá {2} — certifikáty, ktoré TI vydal, sú stiahnuté',
                  [
                    body.revoked_organization,
                    PLACE[body.revoked_organization_kind],
                    when(body.revoked_at),
                  ],
                )}
              </dd>
            </>
          ) : (
            body.in_force_now === false && (
              <>
                <dt>{t('Dnes')}</dt>
                <dd>
                  {t(
                    'akreditácia skončila {0} — certifikáty vydané počas nej platia do konca svojej platnosti',
                    [when(body.accredited_until)],
                  )}
                </dd>
              </>
            )
          )}
        </KeyValue>
      )}
    </>
  );
}

/**
 * Render the existing per-credential verification evidence and time-limited disclosed attributes.
 * @param options - Existing component inputs: {credential, index, count, attributesUntil}.
 * @returns The rendered React content.
 */
export function CredentialEvidence(options) {
  const { credential, index, count, attributesUntil } = options;

  const states = outcomeStates();
  const state = states[credential.state] ?? states.INDETERMINATE;
  const attributes = credential.attributes;
  return (
    <Panel>
      <h2>
        {t('Certifikát')}
        {count > 1 ? ` ${t('{0} z {1}', [index + 1, count])}` : ''}{' '}
        <Badge tone={credential.state}>{credential.state}</Badge>
      </h2>
      {credential.reason && credential.state !== 'VALID' && (
        <Notice tone={state.tone}>{serverMessage(credential.reason)}</Notice>
      )}

      <h3>{t('Predložené údaje')}</h3>
      {attributes && Object.keys(attributes).length > 0 ? (
        <>
          <KeyValue>
            {inFieldOrder(Object.entries(attributes)).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{fieldLabel(key)}</dt>
                <dd>{fieldValue(value)}</dd>
              </Fragment>
            ))}
          </KeyValue>
          {attributesUntil && (
            <p className="footnote">
              {t('Zobrazené do')} {when(attributesUntil)}
              {t(', potom sa zmažú (komponent 1.2).')}
            </p>
          )}
        </>
      ) : (
        <p className="hint">
          {credential.checks?.signature_valid === false
            ? t('Nezobrazujú sa — podpis neplatí, údaje nemožno pripísať vydavateľovi.')
            : credential.checks?.holder_bound === false
              ? t('Nezobrazujú sa — certifikát nepredložil jeho držiteľ.')
              : credential.checks?.signature_valid
                ? t('Už sa nezobrazujú — uchovávajú sa len krátko po overení (komponent 1.2).')
                : t('Nezobrazujú sa — overenie sa k nim nedostalo.')}
        </p>
      )}

      <h3>{t('Platnosť')}</h3>
      <KeyValue>
        <dt>{t('Platný od')}</dt>
        <dd>{when(credential.valid_from)}</dd>
        <dt>{t('Platný do')}</dt>
        <dd>{when(credential.valid_until)}</dd>
      </KeyValue>

      <h3>{t('Vydavateľ a podpis (DIDR)')}</h3>
      <KeyValue>
        <dt>{t('Vydavateľ')}</dt>
        <dd>{credential.issuer || '—'}</dd>
        <dt>{t('Kľúč')}</dt>
        <dd>{credential.key_id || '—'}</dd>
        <dt>{t('DID dokument k')}</dt>
        <dd>
          {when(credential.resolved_at)} {t('— stav ku dňu vydania (D10)')}
        </dd>
      </KeyValue>

      <h3>{t('Akreditačný reťazec (TIR)')}</h3>
      {credential.trust_chain?.length ? (
        <ol className="chain">
          {[...credential.trust_chain].reverse().map((link) => (
            <li key={link.did}>
              <b>{roleLabel(link.role)}</b> <span className="mono">{link.did}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">{t('Nevyhodnotený — overenie sa zastavilo pred ním.')}</p>
      )}

      <CertificationBody body={credential.certification_body} />

      <h3>{t('Schémy (TSR)')}</h3>
      {credential.schemas?.length ? (
        <ul>
          {credential.schemas.map((id) => (
            <li key={id} className="mono">
              {id}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t('Nevyhodnotené.')}</p>
      )}

      <h3>{t('Stav v kontrakte riadenia')}</h3>
      {credential.ledger ? (
        <KeyValue>
          <dt>{t('Záznam')}</dt>
          <dd>
            <Badge tone={standingTone(credential.ledger.standing)}>
              {standingText(credential.ledger.standing)}
            </Badge>
          </dd>
          {credential.ledger.certificate_number && (
            <>
              <dt>{t('Číslo certifikátu')}</dt>
              <dd>{credential.ledger.certificate_number}</dd>
            </>
          )}
          <dt>{t('Kontrakt')}</dt>
          <dd className="mono">{credential.ledger.contract}</dd>
          <dt>{t('Zapísaný')}</dt>
          <dd>{when(credential.ledger.registered_at)}</dd>
          <dt>{t('Naposledy zmenený')}</dt>
          <dd>{when(credential.ledger.changed_at)}</dd>
        </KeyValue>
      ) : (
        <p className="hint">{t('Nevyhodnotené — overenie sa zastavilo pred kontrolou stavu.')}</p>
      )}

      <p className="footnote">
        {t('Overené')} {when(credential.checked_at)}
        {t(
          '. Stav certifikátu je len jeho záznam v kontrakte riadenia; status listy sa nepoužívajú (D36).',
        )}
      </p>
    </Panel>
  );
}
