import { developmentWalletDid } from '../development-wallet.ts';

/**
 * The development wallets of the TAO and the TI the organization browser suite appoints, and
 * their DIDs, which its test server registers in the DID Registry before the suite starts.
 */
export const organizationSuiteWallets = { tao: 100, ti: 101 } as const;

/** The DIDs the suite's TAO and TI bring. */
export const organizationSuiteDids = {
  tao: developmentWalletDid(organizationSuiteWallets.tao),
  ti: developmentWalletDid(organizationSuiteWallets.ti),
};
