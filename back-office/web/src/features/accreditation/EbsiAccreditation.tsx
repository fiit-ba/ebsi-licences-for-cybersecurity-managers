// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useCallback, useEffect, useState } from 'react';
import { ebsiAccreditation } from '../../shared/api/accreditation.ts';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import CodeText from '../../shared/ui/CodeText.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import Notice from '../../shared/ui/Notice.tsx';
import Table from '../../shared/ui/Table.tsx';
import { t } from '../../shared/i18n/index.ts';

/**
 * The localized purpose of each back-office key.
 * @returns Labels by key purpose.
 */
function purposes() {
  return {
    credential_signing: t('podpisovanie poverení'),
    did_authentication: t('autentifikácia DID'),
    ledger_transactions: t('transakcie na ledgeri'),
    governance_role_a: t('rola A v kontrakte riadenia'),
    governance_role_b: t('rola B v kontrakte riadenia'),
  };
}

/**
 * Explain a refusal of the check.
 * @param error - Backend refusal.
 * @returns The localized explanation.
 */
function refusal(error) {
  if (error.reason === 'EbsiUnavailable')
    return t('Registre EBSI nie sú v tejto inštalácii nastavené.');
  if (error.reason === 'RegistryUnavailable')
    return t('Registre EBSI sa teraz nepodarilo skontrolovať. Skúste to znova.');
  if (error.reason === 'NotYours')
    return t('Akreditáciu môže skontrolovať len organizácia sama alebo tá, ktorá ju vybrala.');
  return error.message;
}

/**
 * An organization's accreditation in EBSI. The organization brings its own DID; its accreditor
 * issues the accreditation here, and the organization stores it in the Trusted Issuers Registry
 * with its own wallet, after listing the back-office's keys in its DID document. Opening the
 * panel checks the registries; nothing is checked in the background.
 * @param options - Component inputs: {organizationId, own}: an organization the signed-in one
 * appointed, or the signed-in organization itself (`own`).
 * @returns The rendered React content.
 */
export default function EbsiAccreditation(options) {
  const { organizationId = null, own = false } = options;
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setState(await ebsiAccreditation(organizationId));
    } catch (e) {
      setError(refusal(e));
    } finally {
      setBusy(false);
    }
  }, [organizationId]);

  useEffect(() => {
    check();
  }, [check]);

  /**
   * Save the accreditation as a file for the organization's wallet.
   * @returns No return value.
   */
  function download() {
    const url = URL.createObjectURL(new Blob([state.accreditation], { type: 'application/jwt' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'accreditation.jwt';
    link.click();
    URL.revokeObjectURL(url);
  }

  const labels = purposes();
  return (
    <div className="ebsi-accreditation">
      {error && <Notice tone="err">{error}</Notice>}
      {busy && !state && <div className="small-muted">{t('Kontrolujú sa registre EBSI…')}</div>}
      {state && (
        <>
          <div>
            {state.accredited ? (
              <Badge tone="approved">{t('akreditovaná v EBSI')}</Badge>
            ) : (
              <Badge tone="pending">{t('čaká na zápis do TIR')}</Badge>
            )}
          </div>
          <div className="small-muted mt-1">
            DID <span className="mono">{state.did}</span>
          </div>
          <h4 className="mt-3">{t('1. Kľúče back-office v DID dokumente')}</h4>
          <p className="small-muted">
            {own
              ? t(
                  'Pridajte tieto kľúče do svojho DID dokumentu svojou peňaženkou, ako kontrolór DID. Back-office nimi podpisuje za vašu organizáciu; kedykoľvek ich môžete odobrať.',
                )
              : t('Organizácia ich pridáva do svojho DID dokumentu svojou peňaženkou.')}
          </p>
          {state.keys.length ? (
            <Table>
              <thead>
                <tr>
                  <th>{t('Účel')}</th>
                  <th>{t('Kľúč')}</th>
                  <th>{t('Vzťahy')}</th>
                  <th>{t('V DID dokumente')}</th>
                </tr>
              </thead>
              <tbody>
                {state.keys.map((key) => (
                  <tr key={key.kid}>
                    <td>{labels[key.purpose] ?? key.purpose}</td>
                    <td>
                      <CodeText wrap>{key.kid}</CodeText>
                      <CodeText className="small-muted" wrap>
                        {JSON.stringify(key.public_jwk)}
                      </CodeText>
                    </td>
                    <td className="mono">{key.relationships.join(', ')}</td>
                    <td>
                      {key.listed ? (
                        <Badge tone="approved">{t('áno')}</Badge>
                      ) : (
                        <Badge tone="pending">{t('nie')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="small-muted">
              {t('Kľúče vzniknú, keď sa organizácia zaregistruje pozvánkou.')}
            </div>
          )}
          <h4 className="mt-3">{t('2. Akreditácia na zápis do TIR')}</h4>
          {state.accreditation ? (
            <>
              <p className="small-muted">
                {own
                  ? t(
                      'Vašu akreditáciu vydal ten, kto vás vybral. Uložte ju do registra dôveryhodných vydavateľov (TIR) svojou peňaženkou: predložte ju pre token issuers-registry:invite a zapíšte ju cez setAttributeData.',
                    )
                  : t(
                      'Akreditáciu ste vydali vy; organizácia si ju stiahne a uloží do TIR svojou peňaženkou. Môžete ju poslať aj inak.',
                    )}
              </p>
              <FormActions className="row-tight">
                <Button size="sm" variant="ghost" onClick={download}>
                  {t('Stiahnuť akreditáciu (.jwt)')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigator.clipboard?.writeText(state.accreditation)}
                >
                  {t('Kopírovať')}
                </Button>
              </FormActions>
            </>
          ) : (
            <div className="small-muted">
              {t('Akreditácia sa vydá, keď sa organizácia zaregistruje pozvánkou.')}
            </div>
          )}
          <FormActions className="mt-3">
            <Button size="sm" disabled={busy} onClick={check}>
              {busy ? t('Kontroluje sa…') : t('Skontrolovať v EBSI')}
            </Button>
          </FormActions>
        </>
      )}
    </div>
  );
}
