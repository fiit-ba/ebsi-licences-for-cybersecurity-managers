// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { POLICY_KINDS } from '../../../blockchain/governance.ts';
import Button from '../../../shared/ui/Button.tsx';
import FormActions from '../../../shared/ui/FormActions.tsx';
import KeyValue from '../../../shared/ui/KeyValue.tsx';
import Notice from '../../../shared/ui/Notice.tsx';
import Panel from '../../../shared/ui/Panel.tsx';
import SelectField from '../../../shared/ui/SelectField.tsx';
import { t } from '../../../shared/i18n/index.ts';
import { DAY, kindLabel, policyText, round } from '../governanceFormat.ts';

/**
 * Render one TI's signers, cosigners and policies on the contract, read independently.
 * @param options - Component inputs: {error, info, label, loading, onRefresh, tis, ti, onTi}.
 * @returns The rendered React content.
 */
export default function GovernanceOverview(options) {
  const { error, info, label, loading, onRefresh, tis = [], ti = '', onTi } = options;

  return (
    <Panel
      hint={t(
        'Čítané priamo z ledgeru, nie z back-office. Kontrakt nemení statusy — zaznamenáva, že zmenu schválilo kvórum (komponent 10.5).',
      )}
      title={t('Kontrakt riadenia')}
    >
      {tis.length > 1 && (
        <div className="grid">
          <SelectField
            id="g-ti"
            label={t('TI (vydavateľ)')}
            value={ti}
            onChange={(e) => onTi(e.target.value)}
          >
            {tis.map((item) => (
              <option key={item.did} value={item.did}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      {error && <Notice tone="err">{error}</Notice>}
      {loading && !info && !error && <Notice>{t('Načítava sa stav kontraktu z ledgeru…')}</Notice>}
      {info && !info.ti && !error && (
        <Notice>
          {t(
            'Žiadna TI ešte nemá v kontrakte nastavených signatárov a pravidlá. Nastaví ich TAO po akreditácii TI.',
          )}
        </Notice>
      )}

      {info && (
        <KeyValue>
          <dt>{t('adresa')}</dt>
          <dd>{info.address}</dd>
          {info.ti && (
            <>
              <dt>TI</dt>
              <dd className="mono">{info.ti}</dd>
            </>
          )}
          <dt>{t('signatári')}</dt>
          <dd>
            {info.signers.map((s) => (
              <div key={s.address}>
                {s.address}
                <span className="muted ml-1">{label(s.address)}</span>
              </div>
            ))}
          </dd>
          {info.cosigners.length > 0 && (
            <>
              <dt>{t('spolupodpisovatelia')}</dt>
              <dd>
                {info.cosigners.map((c) => (
                  <div key={c.did}>
                    <span className="mono">{c.did}</span>
                    <span className="muted ml-1">
                      {c.role} · {t('ktorýkoľvek platný kľúč tohto DID')}
                    </span>
                  </div>
                ))}
              </dd>
            </>
          )}
          {info.ti && (
            <>
              <dt>{t('pravidlá')}</dt>
              <dd>
                {POLICY_KINDS.map((kind) => (
                  <div key={kind}>
                    <b>{kindLabel(kind)}</b>:{' '}
                    {policyText(info.policies[kind], info.rolesPresent.length)}
                  </div>
                ))}
              </dd>
            </>
          )}
          <dt>{t('platnosť návrhu')}</dt>
          <dd>
            {info.proposalTtl ? t('{0} dní', [round(info.proposalTtl / DAY)]) : t('bez obmedzenia')}
          </dd>
          <dt>{t('verzia pravidiel')}</dt>
          <dd>{info.version}</dd>
          <dt>{t('počet návrhov')}</dt>
          <dd>{info.proposalCount}</dd>
        </KeyValue>
      )}

      <FormActions>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? t('Načítava sa…') : t('Obnoviť')}
        </Button>
      </FormActions>
    </Panel>
  );
}
