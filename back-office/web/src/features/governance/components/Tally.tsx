// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { t } from '../../../shared/i18n/index.ts';
import { roleName, roleOfSigner } from '../governanceFormat.ts';

/**
 * Who has signed, role by role, against the policy: the quorum counts roles, not keys.
 * @param options - Existing component inputs: {p, policy, info}.
 * @returns The rendered React content.
 */
export default function Tally(options) {
  const { p, policy, info } = options;

  if (!info || !policy) return <span className="mono">{p.signatures.length}</span>;
  // Signatures of keys since removed or replaced - a rotation's own, typically.
  const former = p.signatures.filter((s) => !roleOfSigner(info, s));
  return (
    <div className="tally">
      {info.rolesPresent.map((role) => {
        const yes = p.rolesSigned.includes(role);
        const required = policy.requiredRoles.includes(role);
        const keys = p.signatures.filter((s) => roleOfSigner(info, s) === role);
        return (
          <span
            key={role}
            className={`vote${yes ? ' yes' : ''}`}
            title={[
              `${role} · ${roleName(role) ?? t('rola')} — ${yes ? t('podpísal') : t('nepodpísal')}`,
              required ? t('povinná rola') : '',
              ...keys,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {yes ? '✓' : '·'} {role}
            {required ? '*' : ''}
          </span>
        );
      })}
      <span className="mono muted">
        {p.rolesSigned.length}/{policy.threshold}
      </span>
      {former.length > 0 && (
        <span
          className="muted"
          title={[
            t('Podpisy kľúčov, ktoré už nie sú signatármi; kvórum ich nepočíta.'),
            ...former,
          ].join('\n')}
        >
          {t('+ bývalé kľúče: {0}', [former.length])}
        </span>
      )}
    </div>
  );
}
