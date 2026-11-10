// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

/**
 * Revoking an organization's accreditation on the Akreditácia tab
 * (design decisions D24): how a revoked one is shown, and the form that revokes one.
 */

import { useState } from 'react';
import Badge from '../../shared/ui/Badge.tsx';
import Button from '../../shared/ui/Button.tsx';
import Checkbox from '../../shared/ui/Checkbox.tsx';
import Field from '../../shared/ui/Field.tsx';
import FormActions from '../../shared/ui/FormActions.tsx';
import SelectField from '../../shared/ui/SelectField.tsx';
import TextInput from '../../shared/ui/TextInput.tsx';
import {
  ORGANIZATION_REVOCATION_REASONS,
  REVOCATION_NOTE_MAX,
  revocationReasonLabel,
} from '../../shared/organizationRevocation.ts';
import { PLACE } from '../../shared/places.ts';
import { formatDateTime as when, t } from '../../shared/i18n/index.ts';

/**
 * A revoked accreditation (D24): the organization's own, or the TAO's above a
 * TI, which took the TI's authority with it.
 * @param options - Existing component inputs: {row}.
 * @returns The rendered React content.
 */
export function Revocation(options) {
  const { row } = options;

  const { revoked } = row;
  if (!revoked.own) {
    return (
      <div className="mt-1">
        <Badge tone="rejected">{t('bez oprávnenia')}</Badge>
        <div className="small-muted mt-1">
          {t('akreditácia {0} ({1}) bola odňatá {2}', [
            revoked.organization,
            PLACE[revoked.organization_kind],
            when(revoked.revoked_at),
          ])}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1">
      <Badge tone="rejected">{t('akreditácia odňatá')}</Badge>
      <div className="small-muted mt-1">
        {when(revoked.revoked_at)} — {revocationReasonLabel(revoked.reason)}
        {revoked.note ? `: ${revoked.note}` : ''}
      </div>
      <div className="small-muted mt-1">
        {row.kind === 'tao'
          ? t('jeho TI stratili oprávnenie a ich certifikáty boli stiahnuté')
          : t('jeho certifikáty boli stiahnuté')}
      </div>
    </div>
  );
}

/**
 * Revoke an organization's accreditation (D24), with a reason. It cannot be
 * undone, so it says what follows and waits for that to be acknowledged.
 * @param options - Existing component inputs: {row, onRevoke, onCancel}.
 * @returns The rendered React content.
 */
export function RevokeRow(options) {
  const { row, onRevoke, onCancel } = options;

  const [reason, setReason] = useState(ORGANIZATION_REVOCATION_REASONS[0]);
  const [note, setNote] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const missing = reason === 'other' && !note.trim();

  /**
   * Submit the current form and retain its existing busy, success and refusal states.
   * @param event - Browser form, input or file-selection event for the current workflow.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function submit(event) {
    event.preventDefault();
    if (missing || !understood) return;
    setBusy(true);
    try {
      await onRevoke(reason, note.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="decision-row">
      <td colSpan={5}>
        <form className="decision" onSubmit={submit}>
          <b>{t('Odňať akreditáciu — {0}', [row.name])}</b>
          <p className="muted mt-1">
            {row.kind === 'tao'
              ? t(
                  'TAO stratí akreditáciu natrvalo a s ním aj všetky TI, ktoré vybral. Ich účty sa už neprihlásia a každý certifikát, ktorý tieto TI vydali, sa hneď pozastaví a navrhne na odňatie (to ešte schváli druhá osoba a kvórum na ledgeri).',
                )
              : t(
                  'TI stratí akreditáciu natrvalo. Jeho účet sa už neprihlási — ani v aplikácii — a každý certifikát, ktorý vydal, sa hneď pozastaví a navrhne na odňatie (to ešte schváli druhá osoba a kvórum na ledgeri).',
                )}
          </p>
          <div className="grid">
            <SelectField
              id="revoke-reason"
              label={t('Dôvod')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {ORGANIZATION_REVOCATION_REASONS.map((code) => (
                <option key={code} value={code}>
                  {revocationReasonLabel(code)}
                </option>
              ))}
            </SelectField>
            <Field
              id="revoke-note"
              label={reason === 'other' ? t('Poznámka (povinná)') : t('Poznámka (voliteľná)')}
            >
              <TextInput
                id="revoke-note"
                value={note}
                maxLength={REVOCATION_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('napr. číslo rozhodnutia alebo spisu')}
              />
            </Field>
          </div>
          <Checkbox
            id="revoke-understood"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          >
            {t(
              'Rozumiem, že odňatie je nevratné: akreditáciu nemožno obnoviť, organizáciu možno len vybrať nanovo.',
            )}
          </Checkbox>
          <FormActions>
            <Button type="submit" className="danger" disabled={missing || !understood || busy}>
              {busy ? t('Odníma sa…') : t('Odňať akreditáciu')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('Zrušiť')}
            </Button>
          </FormActions>
        </form>
      </td>
    </tr>
  );
}
