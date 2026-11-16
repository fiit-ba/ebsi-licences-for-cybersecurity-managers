// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useRef, useState } from 'react';
import { ledgerInfo } from '../blockchain/governance.ts';
import { t } from '../shared/i18n/index.ts';
import Icon from '../shared/ui/Icon.tsx';
import TextInput from '../shared/ui/TextInput.tsx';

/**
 * Copy text through the secure Clipboard API or the browser's legacy fallback.
 * The fallback keeps contract copying available when the development site is
 * opened from a phone or another computer over plain HTTP.
 * @param value - Exact contract address to copy.
 * @returns A promise which resolves after the browser accepted the copy.
 * @throws When neither browser clipboard mechanism accepts the value.
 */
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Plain HTTP and restrictive browser permissions use the fallback below.
    }
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  active?.focus();
  if (!copied) throw new Error('Clipboard unavailable');
}

/**
 * Poll ledger availability and display the configured or operator-selected contract.
 * @param options - Existing component inputs: {contract, onContract}.
 * @returns The rendered React content.
 */
export default function StatusBar(options) {
  const { contract, onContract } = options;

  const [ledger, setLedger] = useState(null);
  const [editing, setEditing] = useState(false);
  const [copyState, setCopyState] = useState('');
  const copyTimer = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const info = await ledgerInfo();
        if (alive) setLedger(info);
      } catch {
        if (alive) setLedger(false);
      }
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

  /**
   * Copy the configured contract and expose a short accessible confirmation.
   * @returns No value; copy completion updates the local confirmation state.
   */
  async function copyContract() {
    if (!contract) return;
    window.clearTimeout(copyTimer.current);
    try {
      await copyText(contract);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyTimer.current = window.setTimeout(() => setCopyState(''), 2500);
  }

  return (
    <div className="statusbar">
      <div className="statusbar-head">
        <div className="statusbar-title">Blockchain</div>
        <span className={`copy-feedback ${copyState === 'failed' ? 'failed' : ''}`} role="status">
          {copyState === 'copied'
            ? t('Skopírované')
            : copyState === 'failed'
              ? t('Kopírovanie zlyhalo')
              : ''}
        </span>
      </div>
      <div className="status-line">
        <i className={`dot ${ledger ? 'ok' : 'bad'}`} />
        <span className="status-label">Besu</span>
        {ledger ? (
          <b>
            chain {ledger.chainId} · {t('blok')} {ledger.blockNumber}
          </b>
        ) : (
          <b>{t('nedostupné')}</b>
        )}
      </div>
      <div className="status-line contract-status">
        <i className={`dot ${contract ? 'ok' : 'warn'}`} />
        <span className="status-label">{t('Kontrakt')}</span>
        {onContract && contract && !editing && (
          <button
            className="contract-edit"
            type="button"
            title={t('Upraviť adresu kontraktu')}
            aria-label={t('Upraviť adresu kontraktu')}
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" size={15} />
          </button>
        )}
      </div>
      {editing ? (
        <div className="contract-editor">
          <TextInput
            autoFocus
            defaultValue={contract}
            onBlur={(e) => {
              onContract(e.target.value.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      ) : contract ? (
        <div className="contract-actions">
          <button
            className="contract-copy"
            type="button"
            title={`${t('Kopírovať adresu kontraktu')}: ${contract}`}
            aria-label={t('Kopírovať adresu kontraktu')}
            onClick={copyContract}
          >
            <span className="mono trunc">{contract}</span>
            <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={16} />
          </button>
        </div>
      ) : onContract ? (
        <button className="contract-empty" type="button" onClick={() => setEditing(true)}>
          {t('Nastaviť adresu kontraktu')}
        </button>
      ) : (
        <span className="contract-empty-text">{t('nenastavený')}</span>
      )}
    </div>
  );
}
