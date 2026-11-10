// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useCallback, useEffect, useRef, useState } from 'react';
import { contractInfo, listProposals, signerRole, tiIdOf } from '../../blockchain/governance.ts';
import { t } from '../../shared/i18n/index.ts';

// Generous: a slow connection must not look like a ledger outage.
const LEDGER_READ_TIMEOUT_MS = 30000;

/**
 * Bound an existing asynchronous operation and always clear its timeout timer.
 * @param promise - Existing asynchronous operation subject to the timeout.
 * @returns The original operation result if it settles before the existing timeout.
 */
function withTimeout(promise) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = window.setTimeout(
      () =>
        reject(new Error(t('Ledger neodpovedá. Skontrolujte Besu RPC a skúste obnoviť stránku.'))),
      LEDGER_READ_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => window.clearTimeout(timeout));
}

/**
 * A sentence for a failed read. ethers' own messages are English and name its
 * internals ("could not decode result data … BAD_DATA"), which is what an
 * address without the contract, or with another contract, produces.
 * @param error - Caught failure from the existing backend, browser or contract operation.
 * @param contract - Configured governance contract address.
 * @returns The existing operator-facing contract or ledger-read refusal.
 */
function explainReadError(error, contract) {
  // The contract answered, but has no rules for this TI yet (addTi not confirmed).
  if (error?.revert?.name === 'UnknownTi') return t('Táto TI nie je v kontrakte nastavená.');
  if (error?.code === 'BAD_DATA' || error?.code === 'CALL_EXCEPTION') {
    return t(
      'Na adrese {0} nie je kontrakt riadenia registra. Skontrolujte adresu kontraktu v stavovom riadku.',
      [contract],
    );
  }
  if (
    error?.code === 'NETWORK_ERROR' ||
    error?.code === 'SERVER_ERROR' ||
    error?.code === 'TIMEOUT'
  ) {
    return t('Ledger neodpovedá. Skontrolujte Besu RPC a skúste obnoviť stránku.');
  }
  return error?.message || String(error);
}

/**
 * Read one TI's rules and proposals independently, rejecting obsolete refresh results.
 * @param contract - Configured governance contract address.
 * @param ti - DID of the TI whose rules and proposals to show; empty until one is chosen.
 * @param account - A key whose role to resolve as well, the connected wallet's; optional.
 * @returns The current configuration, proposals, loading/refusal states and refresh operation.
 */
export default function useGovernanceData(contract, ti = '', account = '') {
  const [info, setInfo] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  // Set on every mount (StrictMode remounts once in development), and before
  // the refresh effect below runs: effects run in the order they are declared.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    const fresh = () => mountedRef.current && request === requestRef.current;

    if (!contract) {
      if (!fresh()) return;
      setInfo(null);
      setProposals([]);
      setError('');
      setLoading(false);
      return;
    }
    if (fresh()) {
      setLoading(true);
      setError('');
    }
    try {
      const [nextInfo, nextProposals] = await withTimeout(
        Promise.all([contractInfo(contract, ti), listProposals(contract)]),
      );
      // Each TI decides its own certificates; another TI's proposals are not this one's to sign.
      const tiId = ti ? tiIdOf(ti).toLowerCase() : '';
      const own = tiId
        ? nextProposals.filter((p) => String(p.tiId).toLowerCase() === tiId)
        : nextProposals;
      // A cosigner's keys (the supervisory authority's, role C) are keys of its DID, not among
      // the TI's signers; the contract tells their role. A removed or replaced key has none.
      const known = new Set(nextInfo.signers.map((s) => s.address.toLowerCase()));
      const others = [
        ...new Set(
          [...own.flatMap((p) => p.signatures), account]
            .filter(Boolean)
            .map((a) => a.toLowerCase()),
        ),
      ].filter((a) => !known.has(a));
      const roles = ti
        ? await withTimeout(
            Promise.all(others.map((a) => signerRole(contract, ti, a).catch(() => ''))),
          )
        : [];
      if (!fresh()) return;
      nextInfo.cosignerKeys = others
        .map((address, i) => ({ address, role: roles[i] }))
        .filter((key) => key.role);
      setInfo(nextInfo);
      setProposals(own);
    } catch (e) {
      if (fresh()) setError(explainReadError(e, contract));
    } finally {
      if (fresh()) setLoading(false);
    }
  }, [contract, ti, account]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { info, proposals, error, loading, refresh };
}
