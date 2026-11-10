// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import {
  LEDGER_CHAIN_ID,
  LEDGER_WALLET_RPC,
  isBrowserWalletAvailable,
} from '../../../blockchain/governance.ts';
import Badge from '../../../shared/ui/Badge.tsx';
import Button from '../../../shared/ui/Button.tsx';
import FormActions from '../../../shared/ui/FormActions.tsx';
import KeyValue from '../../../shared/ui/KeyValue.tsx';
import Notice from '../../../shared/ui/Notice.tsx';
import { t } from '../../../shared/i18n/index.ts';

/**
 * Render wallet connection, signer identity and the existing wrong-network guidance.
 * @param options - Existing component inputs: {wallet, wrongChain, isSigner, label, error, onConnect, onSwitch}.
 * @returns The rendered React content.
 */
export default function WalletVoter(options) {
  const { wallet, wrongChain, isSigner, label, error, onConnect, onSwitch } = options;

  if (!isBrowserWalletAvailable()) {
    return (
      <Notice>
        {t(
          'Ide o externú blockchain peňaženku signatára, napríklad MetaMask — nie o mobilnú peňaženku Atest držiteľa certifikátu.',
        )}{' '}
        {t(
          'V prehliadači nie je peňaženka. Nainštalujte napríklad MetaMask a importujte do nej kľúč signatára — pre lokálnu sieť je kľúčom DID orgánu dohľadu vývojový účet č. 5 z',
        )}{' '}
        <code>contracts/scripts/Networks.sol</code>{' '}
        {t('(verejne známy testovací kľúč). Sieť: chain')} {LEDGER_CHAIN_ID}, RPC{' '}
        <code>{LEDGER_WALLET_RPC}</code>.
      </Notice>
    );
  }
  if (!wallet) {
    return (
      <>
        <FormActions className="row-tight">
          <Button onClick={onConnect}>{t('Pripojiť peňaženku')}</Button>
        </FormActions>
        {error && <Notice tone="err">{error}</Notice>}
      </>
    );
  }
  return (
    <>
      <KeyValue>
        <dt>{t('účet')}</dt>
        <dd>{wallet.address}</dd>
        <dt>{t('sieť')}</dt>
        <dd>chain {wallet.chainId}</dd>
        <dt>{t('rola')}</dt>
        <dd>
          {isSigner ? (
            <Badge tone="VALID">
              {t('signatár ·')} {label(wallet.address)}
            </Badge>
          ) : (
            <Badge>{t('nie je signatár')}</Badge>
          )}
        </dd>
      </KeyValue>

      {wrongChain && (
        <Notice tone="warn">
          {t('Peňaženka je na sieti')} {wallet.chainId}
          {t(', kontrakt je na')} {LEDGER_CHAIN_ID}.
          <FormActions className="mt-1">
            <Button size="sm" onClick={onSwitch}>
              {t('Prepnúť sieť')}
            </Button>
          </FormActions>
        </Notice>
      )}
      {!wrongChain && !isSigner && (
        <Notice>
          {t(
            'Tento účet nie je signatárom. Môže iba uvoľniť expirované návrhy — to kontrakt dovoľuje komukoľvek.',
          )}
        </Notice>
      )}
      {error && <Notice tone="err">{error}</Notice>}

      <p className="footnote">
        {t(
          'Podpisuje peňaženka; kľúč z nej neodchádza a stránka vidí len adresu a hash transakcie. Tak hlasuje orgán dohľadu — bez prístupu k systémom certifikačného orgánu. Po hlasovaní konzola požiada back-office, aby si stav kontraktu znova prečítal; výsledok hlasu mu tým nediktuje, len ho upozorní.',
        )}
      </p>
    </>
  );
}
