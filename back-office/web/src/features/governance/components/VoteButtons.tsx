// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { t } from '../../../shared/i18n/index.ts';
import Button from '../../../shared/ui/Button.tsx';
import { OPEN, same, when } from '../governanceFormat.ts';

/**
 * Only the votes the contract would accept from this voter right now - for a
 * status proposal and a rule change alike. `signBlocked` and `vetoBlocked`
 * say why the back-office or the contract would refuse one.
 * @param options - Existing component inputs: {p, voter, canAct, isSigner, busy, onVote, signBlocked = '', vetoBlocked = ''}.
 * @returns The rendered React content.
 */
export default function VoteButtons(options) {
  const { p, voter, canAct, isSigner, busy, onVote, signBlocked = '', vetoBlocked = '' } = options;

  const now = Date.now() / 1000;
  const signed = Boolean(voter) && p.signatures.some((s) => same(s, voter));
  const running = (kind) => busy === `${p.id}:${kind}`;
  const locked = Boolean(busy) || !canAct;
  const buttons = [];

  if (p.state === 'PROPOSED') {
    buttons.push(
      <Button
        key="sign"
        size="sm"
        disabled={locked || !isSigner || signed || Boolean(signBlocked)}
        title={signBlocked}
        onClick={() => onVote(p, 'sign')}
      >
        {running('sign')
          ? t('Podpisuje sa…')
          : signed
            ? t('Podpísané')
            : signBlocked
              ? t('Čaká na dohľad')
              : t('Podpísať')}
      </Button>,
    );
  }
  if (p.state === 'APPROVED') {
    const waiting = p.executableAt > now;
    buttons.push(
      <Button
        key="execute"
        size="sm"
        disabled={locked || !isSigner || waiting}
        title={waiting ? t('Časový zámok platí do {0}', [when(p.executableAt)]) : ''}
        onClick={() => onVote(p, 'execute')}
      >
        {running('execute')
          ? t('Vykonáva sa…')
          : waiting
            ? t('Čaká na časový zámok')
            : t('Vykonať')}
      </Button>,
    );
  }
  if (OPEN.has(p.state)) {
    buttons.push(
      <Button
        key="cancel"
        className="danger"
        size="sm"
        variant="ghost"
        disabled={locked || !isSigner || Boolean(vetoBlocked)}
        title={vetoBlocked}
        onClick={() => onVote(p, 'cancel')}
      >
        {running('cancel') ? t('Vetuje sa…') : t('Vetovať')}
      </Button>,
    );
  }
  if (p.state === 'EXPIRED' && p.holdsKey) {
    buttons.push(
      <Button
        key="expire"
        size="sm"
        variant="ghost"
        disabled={locked}
        title={t('Návrh prekročil lehotu, no stále blokuje certifikát pred novým návrhom.')}
        onClick={() => onVote(p, 'expire')}
      >
        {running('expire') ? t('Uvoľňuje sa…') : t('Uvoľniť')}
      </Button>,
    );
  }

  if (buttons.length === 0) return <span className="muted">—</span>;
  return <div className="actions">{buttons}</div>;
}
