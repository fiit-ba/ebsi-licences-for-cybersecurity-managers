// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * What the development EBSI service is pointed at: the ledger, EBSI's own
 * contracts on it (deployed from contracts/local/ebsi-mock), the contracts a
 * `ledger:invoke` token may call, and the development keys that act as EBSI's
 * operator and Support Office.
 *
 * Addresses come from the deployment records the contracts' scripts write
 * (contracts/deployments/<network>-ebsi.json and <network>.json), mounted into
 * the container, or from explicit variables, which win.
 */

import fs from 'node:fs';
import {HDNodeWallet, getAddress} from 'ethers';

/** The standard development mnemonic of contracts/scripts/Networks.sol. Public knowledge. */
export const DEVELOPMENT_MNEMONIC = 'test test test test test test test test test test test junk';

/** Chains on which the development keys are acceptable (Networks.sol). */
export const DEVELOPMENT_CHAINS = new Set([1337n, 31337n]);

/**
 * A development key by its index in the development mnemonic.
 * @param {number} index Account index, m/44'/60'/0'/0/<index>.
 * @returns {string} The 0x-prefixed private key.
 */
export function developmentKey(index) {
  return HDNodeWallet.fromPhrase(DEVELOPMENT_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).privateKey;
}

/**
 * Read a JSON deployment record, or nothing when it is not there.
 * @param {string|undefined} file Path inside the container.
 * @returns {object|undefined} The parsed record.
 */
function record(file) {
  if (!file) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the deployment record ${file}: ${error.message}`);
  }
}

/**
 * An address from an explicit variable, else from a deployment record.
 * @param {string|undefined} explicit Value of the environment variable.
 * @param {string|undefined} recorded Value read from the record.
 * @returns {string|undefined} The checksummed address.
 */
function address(explicit, recorded) {
  const value = explicit || recorded;
  return value ? getAddress(value) : undefined;
}

/**
 * Read the configuration from the environment.
 * @param {NodeJS.ProcessEnv} env The environment.
 * @returns {object} The service configuration.
 */
export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8090);
  const base = (env.MOCK_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const ebsi = record(env.MOCK_EBSI_DEPLOYMENT)?.ebsi ?? {};
  const governance = record(env.MOCK_GOVERNANCE_DEPLOYMENT) ?? {};
  const contracts = {
    didRegistry: address(env.MOCK_DID_REGISTRY, ebsi.DidRegistry?.contractAddress),
    issuersRegistry: address(env.MOCK_ISSUERS_REGISTRY, ebsi.IssuersRegistry?.contractAddress),
    schemasRegistry: address(env.MOCK_SCHEMAS_REGISTRY, ebsi.SchemasRegistry?.contractAddress),
    timestamp: address(env.MOCK_TIMESTAMP, ebsi.Timestamp?.contractAddress),
    policiesRegistry: address(env.MOCK_POLICIES_REGISTRY, ebsi.PolicyRegistry?.contractAddress),
  };
  // The Trusted Contracts a `ledger:invoke` token may call: the certificate
  // registry and its governance, from their deployment record unless named.
  const invoke = (
    env.MOCK_INVOKE_CONTRACTS
      ? env.MOCK_INVOKE_CONTRACTS.split(',')
      : [governance.CertificateGovernance?.address, governance.CertificateRegistry?.address]
  )
    .map((value) => value?.trim())
    .filter(Boolean)
    .map((value) => getAddress(value));
  return {
    port,
    base,
    rpc: env.MOCK_LEDGER_RPC_URL || 'http://host.docker.internal:8545',
    contracts,
    invoke,
    // EBSI's operator: admin and operator of the Policies Registry on a
    // development chain (scripts/SetupEBSIInfrastructure.s.sol, the deployer).
    adminKey: env.MOCK_ADMIN_KEY || developmentKey(0),
    supportOffice: {
      did: env.MOCK_SUPPORT_OFFICE_DID || 'did:ebsi:zSupport',
      // An index Networks.sol gives no role.
      key: env.MOCK_SUPPORT_OFFICE_KEY || developmentKey(9),
    },
    // The supervisory authority (NBÚ), who cosigns every TI's decisions as role C
    // with any valid key of its DID; on a development chain the key Networks.sol
    // gives NBÚ (index 5). Empty MOCK_SUPERVISOR_DID leaves it out.
    supervisor: {
      did: env.MOCK_SUPERVISOR_DID ?? 'did:ebsi:zrFwbt4GwApPbWm9racT3x9',
      key: env.MOCK_SUPERVISOR_KEY || developmentKey(5),
    },
    // Gas a development key is given when it asks (POST /__mock/fund), in wei.
    funding: BigInt(env.MOCK_FUNDING_WEI || 10n ** 19n),
    quiet: env.QUIET === '1',
  };
}
