// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { POLICY_KINDS } from '../../../blockchain/governance.ts';
import { t } from '../../../shared/i18n/index.ts';
import Checkbox from '../../../shared/ui/Checkbox.tsx';
import CheckboxGroup from '../../../shared/ui/CheckboxGroup.tsx';
import Field from '../../../shared/ui/Field.tsx';
import SelectField from '../../../shared/ui/SelectField.tsx';
import TextInput from '../../../shared/ui/TextInput.tsx';
import { DAY, HOUR, kindLabel, roleName, round, short } from '../governanceFormat.ts';
import { formFor } from './ruleChange.ts';

/**
 * Render the existing policy, signer-rotation and proposal-lifetime change fields.
 * @param options - Existing component inputs: {bounds, form, info, label, onForm}.
 * @returns The rendered React content.
 */
export default function RuleChangeForm(options) {
  const { bounds, form, info, label, onForm } = options;

  const n = info.rolesPresent.length;
  const set = (fields) => onForm((current) => ({ ...current, ...fields }));
  const timelockBounds = bounds?.timelock?.[form.kind];
  const noTimelock = timelockBounds && timelockBounds[1] === 0;
  const lastSupervisorKey = (s) =>
    s.role === 'C' && info.signers.filter((other) => other.role === 'C').length === 1;

  return (
    <>
      <div className="grid">
        <SelectField
          id="r-action"
          label={t('Zmena')}
          value={form.action}
          onChange={(e) => onForm(formFor(e.target.value, info, form.kind))}
        >
          <option value="set_policy">{t('Zmeniť pravidlo rozhodovania')}</option>
          <option value="replace_signer">{t('Vymeniť kľúč (rotácia)')}</option>
          <option value="add_signer">{t('Pridať kľúč')}</option>
          <option value="remove_signer">{t('Odobrať kľúč')}</option>
          <option value="set_proposal_ttl">{t('Zmeniť platnosť návrhov')}</option>
        </SelectField>

        {form.action === 'set_policy' && (
          <>
            <SelectField
              id="r-kind"
              label={t('Pre')}
              value={form.kind}
              onChange={(e) => onForm(formFor('set_policy', info, e.target.value))}
            >
              {POLICY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="r-threshold"
              label={t('Prah')}
              value={form.threshold}
              onChange={(e) => set({ threshold: e.target.value })}
            >
              {Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2).map((v) => (
                <option key={v} value={v}>
                  {t('{0} z {1} rolí', [v, n])}
                  {v === info.policies[form.kind].threshold
                    ? t(' (súčasný)')
                    : v === n
                      ? t(' (všetky)')
                      : ''}
                </option>
              ))}
            </SelectField>
            <Field
              id="r-timelock"
              label={`${t('Časový zámok (h)')}${timelockBounds && !noTimelock ? ` ${round(timelockBounds[0] / HOUR)}–${round(timelockBounds[1] / HOUR)}` : ''}`}
            >
              <TextInput
                id="r-timelock"
                type="number"
                min={timelockBounds ? timelockBounds[0] / HOUR : 0}
                max={timelockBounds ? timelockBounds[1] / HOUR : undefined}
                step="1"
                disabled={noTimelock}
                value={form.timelockHours}
                onChange={(e) => set({ timelockHours: e.target.value })}
              />
            </Field>
          </>
        )}

        {(form.action === 'remove_signer' || form.action === 'replace_signer') && (
          <SelectField
            id="r-subject"
            label={t('Kľúč')}
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
          >
            <option value="">—</option>
            {info.signers.map((s) => (
              <option
                key={s.address}
                value={s.address}
                disabled={form.action === 'remove_signer' && lastSupervisorKey(s)}
              >
                {short(s.address)} · {label(s.address)}
                {form.action === 'remove_signer' && lastSupervisorKey(s)
                  ? t(' — nedá sa odobrať')
                  : ''}
              </option>
            ))}
          </SelectField>
        )}
        {form.action === 'replace_signer' && (
          <Field
            id="r-replacement"
            label={t('Nový kľúč')}
            hint={t('Musí to byť platný kľúč DID tejto TI v registri DID.')}
          >
            <TextInput
              id="r-replacement"
              value={form.replacement}
              placeholder="0x…"
              onChange={(e) => set({ replacement: e.target.value })}
            />
          </Field>
        )}
        {form.action === 'add_signer' && (
          <>
            <Field
              id="r-new"
              label={t('Adresa nového kľúča')}
              hint={t('Musí to byť platný kľúč DID tejto TI v registri DID.')}
            >
              <TextInput
                id="r-new"
                value={form.subject}
                placeholder="0x…"
                onChange={(e) => set({ subject: e.target.value })}
              />
            </Field>
            <SelectField
              id="r-role"
              label={t('Rola')}
              value={form.signerRole}
              onChange={(e) => set({ signerRole: e.target.value })}
            >
              {/* The TI's own keys are A and B; the supervisory authority signs as a cosigner
                  DID, which the TAO sets. */}
              {['A', 'B'].map((r) => (
                <option key={r} value={r}>
                  {r} · {roleName(r) ?? t('rola')}
                </option>
              ))}
            </SelectField>
          </>
        )}
        {form.action === 'set_proposal_ttl' && (
          <Field
            id="r-ttl"
            label={`${t('Platnosť návrhu (dni)')}${bounds?.ttl ? ` ${round(bounds.ttl[0] / DAY)}–${round(bounds.ttl[1] / DAY)}` : ''}`}
          >
            <TextInput
              id="r-ttl"
              type="number"
              min={bounds?.ttl ? bounds.ttl[0] / DAY : 1}
              max={bounds?.ttl ? bounds.ttl[1] / DAY : undefined}
              step="1"
              value={form.ttlDays}
              onChange={(e) => set({ ttlDays: e.target.value })}
            />
          </Field>
        )}
      </div>

      {form.action === 'set_policy' && (
        <Field className="mt-2" label={t('Povinné roly')}>
          <CheckboxGroup>
            {info.rolesPresent.map((r) => (
              <Checkbox
                key={r}
                checked={form.required.includes(r)}
                onChange={(e) =>
                  set({
                    required: e.target.checked
                      ? [...form.required, r]
                      : form.required.filter((x) => x !== r),
                  })
                }
              >
                {r} · {roleName(r) ?? t('rola')}
              </Checkbox>
            ))}
          </CheckboxGroup>
        </Field>
      )}
      {form.action === 'set_policy' && (
        <Field className="mt-2" label={t('Právo veta')}>
          <CheckboxGroup>
            {info.rolesPresent.map((r) => (
              <Checkbox
                key={r}
                checked={form.veto.includes(r)}
                onChange={(e) =>
                  set({
                    veto: e.target.checked ? [...form.veto, r] : form.veto.filter((x) => x !== r),
                  })
                }
              >
                {r} · {roleName(r) ?? t('rola')}
              </Checkbox>
            ))}
          </CheckboxGroup>
        </Field>
      )}
    </>
  );
}
