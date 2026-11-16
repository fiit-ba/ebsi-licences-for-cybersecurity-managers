// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

// What awaits the user, shown once after they sign in: the open requests to
// suspend, revoke or reinstate a certificate in their scope. Each leads to
// where it is decided - the four-eyes approval in Životný cyklus, or the
// vote on the governance contract once the request is there.

import { useNavigate } from 'react-router-dom';
import { formatDateTime, t } from '../shared/i18n/index.ts';
import Badge from '../shared/ui/Badge.tsx';
import Button from '../shared/ui/Button.tsx';

const ACTIONS = {
  suspend: () => t('Pozastavenie'),
  revoke: () => t('Odňatie'),
  reinstate: () => t('Obnovenie'),
};

/**
 * Where an item is decided, and what it waits for.
 * @param item - Existing sign-in notice and its linked proposal identifiers.
 * @returns The lifecycle/governance destination, notice label and display tone.
 */
function routeOf(item) {
  if (item.can_approve) {
    return {
      to: `/lifecycle?case=${encodeURIComponent(item.proposal_id)}`,
      label: t('čaká na vaše schválenie'),
      tone: 'pending',
    };
  }
  if (item.approved && item.onchain_proposal_id) {
    return {
      to: `/governance?proposal=${encodeURIComponent(item.onchain_proposal_id)}`,
      label: t('hlasovanie na chaine #{0}', [item.onchain_proposal_id]),
      tone: 'APPROVED',
    };
  }
  return {
    to: `/lifecycle?case=${encodeURIComponent(item.proposal_id)}`,
    label: t('čaká na druhého schvaľovateľa'),
    tone: 'PROPOSED',
  };
}

/**
 * Render the dismissible pending-case notice loaded at sign-in.
 * @param options - Existing component inputs: {notices, onClose}.
 * @returns The rendered React content.
 */
export default function SignInNotices(options) {
  const { notices, onClose } = options;

  const navigate = useNavigate();
  if (!notices || notices.items.length === 0) return null;
  const waiting = notices.waiting ?? notices.items.filter((item) => item.can_approve).length;
  return (
    <section className="signin-notices" role="status" aria-live="polite">
      <div className="signin-notices-head">
        <strong>
          {waiting > 0
            ? t('Na vaše schválenie čakajú žiadosti o zmenu stavu certifikátov: {0}', [waiting])
            : t('Otvorené žiadosti o zmenu stavu certifikátov: {0}', [notices.total])}
        </strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('Zavrieť')}
        </Button>
      </div>
      <ul>
        {notices.items.map((item) => {
          const route = routeOf(item);
          return (
            <li key={item.proposal_id}>
              <button type="button" className="signin-notice" onClick={() => navigate(route.to)}>
                <span>
                  {(ACTIONS[item.action] ?? (() => item.action))()} ·{' '}
                  <span className="mono">{item.reference || item.credential_id}</span>
                  {item.issuer ? ` · ${item.issuer}` : ''}
                </span>
                <span className="muted">
                  {t('navrhol {0}, {1}', [
                    item.proposed_by,
                    formatDateTime(new Date(item.proposed_at)),
                  ])}
                </span>
                <Badge tone={route.tone}>{route.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
      {notices.total > notices.items.length && (
        <p className="muted">
          {t('…a ďalšie: {0}. Všetky sú v Životnom cykle.', [notices.total - notices.items.length])}
        </p>
      )}
    </section>
  );
}
