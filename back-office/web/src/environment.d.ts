import type { Eip1193Provider } from 'ethers';

/** Browser wallet injected by an EIP-1193 extension; private keys stay in that extension. */
type BrowserWallet = Eip1193Provider & {
  on?(event: string, callback: () => void): void;
  removeListener?(event: string, callback: () => void): void;
};

declare global {
  /** Browser environment with the optional existing wallet integration. */
  interface Window {
    ethereum?: BrowserWallet;
  }
}
