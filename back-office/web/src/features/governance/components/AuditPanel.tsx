// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useState } from 'react';
import { verifyRecordKey } from '../../../blockchain/governance.ts';
import Button from '../../../shared/ui/Button.tsx';
import CodeText from '../../../shared/ui/CodeText.tsx';
import Field from '../../../shared/ui/Field.tsx';
import FormActions from '../../../shared/ui/FormActions.tsx';
import Notice from '../../../shared/ui/Notice.tsx';
import Panel from '../../../shared/ui/Panel.tsx';
import TextInput from '../../../shared/ui/TextInput.tsx';
import { t } from '../../../shared/i18n/index.ts';

/**
 * Audit verification (component 10.7): a proposal names the record of exactly this certificate.
 * @param options - Existing component inputs: {contract}.
 * @returns The rendered React content.
 */
export default function AuditPanel(options) {
  const { contract } = options;

  const [form, setForm] = useState({
    proposalId: '1',
    issuerDid: '',
    certificateId: '',
  });
  const [out, setOut] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * Run the requested operation and retain its existing visible result and refusal state.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function run(event) {
    event.preventDefault();
    setOut({ state: 'running' });
    try {
      const r = await verifyRecordKey(contract, Number(form.proposalId), {
        issuerDid: form.issuerDid.trim(),
        certificateId: form.certificateId.trim(),
      });
      setOut({ state: 'done', ...r });
    } catch (e) {
      setOut({ state: 'error', message: e.message });
    }
  }

  return (
    <Panel
      as="form"
      hint={t(
        'Audítor získa z back-office DID vydavateľa a identifikátor vyzdvihnutej licencie, nechá register certifikátov vypočítať kľúč záznamu a porovná ho s návrhom na chaine (komponent 10.7). Výpočet robí kontrakt, teda rovnaká cesta, akú by použil nezávislý audítor.',
      )}
      title={t('Auditné overenie')}
      onSubmit={run}
    >
      <div className="grid">
        <Field id="a-id" label={t('ID návrhu')}>
          <TextInput
            id="a-id"
            value={form.proposalId}
            onChange={(e) => set('proposalId', e.target.value)}
          />
        </Field>
        <Field id="a-did" label={t('DID vydavateľa')}>
          <TextInput
            id="a-did"
            value={form.issuerDid}
            onChange={(e) => set('issuerDid', e.target.value)}
            placeholder="did:ebsi:z…"
            required
          />
        </Field>
        <Field id="a-certificate" label={t('Identifikátor licencie')}>
          <TextInput
            id="a-certificate"
            value={form.certificateId}
            onChange={(e) => set('certificateId', e.target.value)}
            placeholder={t('napr. urn:uuid:…')}
            required
          />
        </Field>
      </div>

      <FormActions>
        <Button variant="ghost" type="submit">
          {t('Overiť kľúč záznamu')}
        </Button>
      </FormActions>

      {out?.state === 'error' && <Notice tone="err">{out.message}</Notice>}
      {out?.state === 'done' && (
        <Notice tone={out.matches ? 'ok' : 'err'}>
          {out.matches
            ? t('Zhoda — návrh na chaine patrí k tomuto certifikátu.')
            : t('Nezhoda — návrh na chaine sa týka iného záznamu.')}
          <CodeText className="mt-1" wrap>
            {out.expected}
          </CodeText>
        </Notice>
      )}

      <p className="footnote">
        {t(
          'Identifikátor licencie pozná len ten, komu ju držiteľ ukázal, a back-office; kľúč záznamu z neho vypočíta ktokoľvek. Verejný uzol vidí, na čo sa ho pýtate — tam, kde na tom záleží, počítajte kľúč lokálne.',
        )}
      </p>
    </Panel>
  );
}
