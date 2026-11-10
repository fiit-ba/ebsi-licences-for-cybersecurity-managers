// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useState } from 'react';
import {
  connectWallet,
  currentWallet,
  explainVoteError,
  onWalletChange,
  switchToLedger,
} from '../../blockchain/governance.ts';

/**
 * Track the external wallet account and network and expose connection operations.
 * @returns The current wallet/refusal and connection and network-switch operations.
 */
export default function useWalletVoter() {
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState('');

  // Follow account and network switches made in the wallet itself.
  useEffect(
    () =>
      onWalletChange(async () => {
        try {
          setWallet(await currentWallet());
        } catch {
          setWallet(null);
        }
      }),
    [],
  );

  /**
   * Connect the browser wallet and retain its account or operator-facing refusal.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function connect() {
    setWalletError('');
    try {
      setWallet(await connectWallet());
    } catch (e) {
      setWalletError(explainVoteError(e));
    }
  }

  /**
   * Switch the wallet to the configured ledger and refresh its current account state.
   * @returns No return value; the existing operation updates its owned state or storage.
   */
  async function switchChain() {
    setWalletError('');
    try {
      await switchToLedger();
      setWallet(await currentWallet());
    } catch (e) {
      setWalletError(explainVoteError(e));
    }
  }

  return { wallet, walletError, connect, switchChain };
}
