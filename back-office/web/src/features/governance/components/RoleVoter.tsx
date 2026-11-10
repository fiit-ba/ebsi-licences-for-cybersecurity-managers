// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { t } from '../../../shared/i18n/index.ts';
import Notice from '../../../shared/ui/Notice.tsx';
import SelectField from '../../../shared/ui/SelectField.tsx';
import { roleName, short } from '../governanceFormat.ts';

/**
 * Render the current operator permitted backend roles and their signer addresses.
 * @param options - Existing component inputs: {roles, role, onRole}.
 * @returns The rendered React content.
 */
export default function RoleVoter(options) {
  const { roles, role, onRole } = options;

  if (!roles) return <p className="hint">{t('Načítava sa…')}</p>;
  if (roles.error) return <Notice tone="err">{roles.error}</Notice>;
  if (!roles.enabled) {
    return (
      <Notice>
        {t('Back-office nemá nakonfigurovaný kontrakt (')}
        <code>PLR_GOVERNANCE_CONTRACT</code>
        {t('), takže cez back-office hlasovať nemožno. Externou peňaženkou signatára áno.')}
      </Notice>
    );
  }
  if (roles.roles.length === 0) {
    return (
      <Notice>
        {t(
          'Nemáte pridelenú žiadnu rolu riadenia. Hlasovať za certifikačný orgán môže len ten, koho správca zaradí do skupiny',
        )}{' '}
        {roles.console_roles.map((r, i) => (
          <span key={r}>
            {i > 0 && t(' alebo ')}
            <code>plr_governance_{r.toLowerCase()}</code> ({r})
          </span>
        ))}
        {t('. Byť prihlásený nestačí — ani ako administrátor.')}
      </Notice>
    );
  }
  return (
    <>
      <div className="grid">
        <SelectField
          id="g-role"
          label={t('Hlasovať ako')}
          value={role}
          onChange={(e) => onRole(e.target.value)}
        >
          {roles.roles.map((r) => (
            <option key={r} value={r}>
              {r} · {roleName(r) ?? 'rola'}
              {roles.addresses[r] ? ` (${short(roles.addresses[r])})` : ''}
            </option>
          ))}
        </SelectField>
      </div>

      {roles.addresses[roles.supervisor_role] && (
        <Notice tone="warn">
          {t(
            'V tomto nasadení drží back-office aj kľúč orgánu dohľadu. Na demo to stačí, no nezávislosť tretieho podpisu je potom len simulovaná — v produkcii má tento kľúč výhradne orgán dohľadu.',
          )}
        </Notice>
      )}

      <p className="footnote">
        {t(
          'Kľúč roly je v KMS a nikto ho nevidí — ani konzola, ani back-office. Back-office zostaví transakciu a požiada KMS o podpis, len ak ide presne o schválený úkon. Podpis za rolu',
        )}{' '}
        {roles.approver_role}{' '}
        {t(
          'na návrhu, ktorý v back-office ešte nikto neschválil, je zároveň tým schválením — preto ho musí urobiť iný človek, než kto zmenu navrhol. Rola orgánu dohľadu tu zámerne nie je: jeho podpis má cenu len vtedy, keď ho urobí vlastným kľúčom mimo systémov certifikačného orgánu (komponent 10.2).',
        )}
      </p>
    </>
  );
}
