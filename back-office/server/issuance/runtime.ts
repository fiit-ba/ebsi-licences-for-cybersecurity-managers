import { auditedLedgerSigner } from '../keys/ledger-signing.ts';
import { jwkAddress } from '../ebsi/runtime.ts';
import { consoleLedger } from '../lifecycle/console-ledger.ts';
import { postgresConsoleGovernance } from '../lifecycle/console-governance.ts';
import { postgresGovernanceDelivery } from '../lifecycle/delivery.ts';
import { postgresAudit } from '../audit/service.ts';
import { postgresEmergencyDelivery } from '../lifecycle/emergency-delivery.ts';
import { emergencyLedger } from '../lifecycle/emergency-ledger.ts';
import { postgresEmergencySuspension, postgresPendingSuspension } from '../lifecycle/emergency.ts';
import { governanceActions } from '../lifecycle/governance.ts';
import { postgresStatusProposals } from '../lifecycle/proposals.ts';
import { postgresCertificateList } from '../lifecycle/certificates.ts';
import { postgresStandingRefresh } from '../lifecycle/standing.ts';
import { tsrCredentialValidation } from '../verification/schema-validation.ts';
import { configuredVerification } from '../verification/runtime.ts';
import { getAddress, type Signer } from 'ethers';
import {
  contractTemplates,
  factoryDeployments,
  taoContractDirectory,
  type TaoContractDirectory,
  type TaoContracts,
} from '../lifecycle/tao-contracts.ts';
import type { ConsoleLedgers } from '../lifecycle/console-governance.ts';
import type { EmergencyLedger } from '../lifecycle/emergency-ledger.ts';
import type { GovernanceActions } from '../lifecycle/governance.ts';
import type { CertificateLedger } from './types.ts';
import type { CertificateRegistries } from '../verification/types.ts';
import { certificateRegistries, UntrustedRegistry } from '../verification/registry-trust.ts';
import { ebsiIssuerTrust } from './ebsi-trust.ts';
import { governanceLedger } from './governance-ledger.ts';
import { createIssuer } from './issuer.ts';
import { postgresKmsIssuerSigning, postgresAuthorizationSigning } from './kms-signing.ts';
import { configuredEbsi } from '../ebsi/runtime.ts';
import type { Protection } from './protection.ts';
import { configuredFieldProtection } from '../keys/field-protection.ts';
import type { Pool } from 'pg';
import type { trustedSchemaRegistry } from '../schemas/tsr.ts';

const requiredSettings = [
  'BACK_OFFICE_PUBLIC_ORIGIN',
  'AWS_REGION',
  'PLR_TIR_URL',
  'PLR_DIDR_URL',
  'PLR_TSR_URL',
  'PLR_TRUSTED_ROOT_DIDS',
  'PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL',
  'PLR_LEDGER_CHAIN_ID',
  'PLR_LEDGER_RPC_URL',
];

/**
 * Validate an environment setting as a plain HTTP(S) URL.
 *
 * @param value - Environment value.
 * @param name - Setting name used in errors.
 * @returns The accepted URL object.
 * @throws Error for missing or invalid configuration.
 */
function requiredUrl(value: string | undefined, name: string) {
  const url = new URL(value!);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials or a fragment.`);
  }
  return url;
}

/**
 * Build enabled issuance, verification and governance runtime adapters.
 *
 * @param database - PostgreSQL pool.
 * @param registry - Trusted schema registry.
 * @param env - Environment settings; defaults to process.env.
 * @param accreditationGuard - Existing per-issuer cached accreditation policy, when composed by the server.
 * @param ensureIssuer - Existing first-issuance onboarding operation, composed without registration locks.
 * @param protectedFields - Optional already-composed field protection, including isolated test dependencies.
 * @returns The configured adapters and cleanup operation, or undefined when disabled.
 * @throws Error for missing/inconsistent settings; KMS, network and adapter initialization errors.
 */
export async function configuredIssuer(
  database: Pool,
  registry: ReturnType<typeof trustedSchemaRegistry>,
  env = process.env,
  accreditationGuard?: ReturnType<typeof ebsiIssuerTrust>['ensureAccredited'],
  ensureIssuer?: (organization: string, actor: number) => Promise<void>,
  protectedFields?: Protection & { close?(): void },
) {
  const enabled = env.BACK_OFFICE_ISSUANCE_ENABLED ?? 'false';
  if (enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error('BACK_OFFICE_ISSUANCE_ENABLED must be true or false.');

  const missing = requiredSettings.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error('Missing issuance settings: ' + missing.join(', '));
  const protection = protectedFields ?? configuredFieldProtection(database, env);
  const publicOrigin = requiredUrl(env.BACK_OFFICE_PUBLIC_ORIGIN, 'BACK_OFFICE_PUBLIC_ORIGIN');
  if (publicOrigin.href !== publicOrigin.origin + '/')
    throw new Error('Expected an issuer origin without a path or query.');
  const ledgerStatusSchema = requiredUrl(
    env.PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL,
    'PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL',
  );
  const chainId = Number(env.PLR_LEDGER_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId < 1)
    throw new Error('PLR_LEDGER_CHAIN_ID must be a positive integer.');
  const trust = ebsiIssuerTrust({
    tirUrl: env.PLR_TIR_URL!,
    didRegistryUrl: env.PLR_DIDR_URL!,
    didRegistryContract: env.PLR_DIDR_CONTRACT,
    trustedRoots: env
      .PLR_TRUSTED_ROOT_DIDS!.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  });
  // Each TAO has its own certificate registry and governance contract: every record, case and
  // emergency goes to the pair of its TI's TAO. A pair deployed beforehand becomes its TAO's.
  const existing =
    env.PLR_GOVERNANCE_CONTRACT?.trim() && env.PLR_CERTIFICATE_REGISTRY?.trim()
      ? {
          governance: env.PLR_GOVERNANCE_CONTRACT.trim(),
          registry: env.PLR_CERTIFICATE_REGISTRY.trim(),
          block: Number(env.BACK_OFFICE_GOVERNANCE_DEPLOYMENT_BLOCK ?? 0),
        }
      : undefined;
  const factory = env.PLR_PROXY_FACTORY?.trim() ? getAddress(env.PLR_PROXY_FACTORY.trim()) : '';
  const templates = contractTemplates(env.PLR_CONTRACT_TEMPLATES);
  let directory: TaoContractDirectory | undefined;
  let deployedByFactory: ((address: string) => Promise<boolean>) | undefined;
  // Every signed transaction goes through EBSI's Ledger API; a call to a TAO's pair or to EBSI's
  // Proxy Factory (Trusted Contracts) carries a ledger:invoke token for its organization.
  const ebsi = configuredEbsi(
    database,
    env,
    async (address) =>
      address === factory ||
      Boolean(await directory?.byContract(address)) ||
      Boolean(deployedByFactory && (await deployedByFactory(address))),
  )!;
  const { provider, kms } = ebsi;
  directory = taoContractDirectory(database, { existing, provider });
  deployedByFactory = factory ? factoryDeployments(provider, factory) : undefined;
  const confirmations = Number(env.BACK_OFFICE_LEDGER_CONFIRMATIONS ?? 1);
  try {
    const roleSigners = new Map<string, Promise<Signer>>();
    /**
     * Resolve the issuing TI's A or B governance key when signature work needs it.
     * @param issuerDid - The TI whose certificate the transaction concerns.
     * @param role - Body role: A proposes, registers and suspends at once; B approves.
     * @returns One pinned, purpose-bound audited KMS signer per key and process, limited to the
     * TI's TAO's pair.
     * @throws Unknown-TI, missing-key, wrong-purpose, KMS or DB errors.
     */
    function roleKey(issuerDid: string, role: 'A' | 'B') {
      const cacheKey = issuerDid + ' ' + role;
      let signer = roleSigners.get(cacheKey);
      if (!signer) {
        signer = (async () => {
          const {
            rows: [organization],
          } = await database.query(
            "SELECT id FROM accredited_organizations WHERE did=$1 AND kind='ti'",
            [issuerDid],
          );
          if (!organization) throw new Error('The certificate names no TI of this registry.');
          const pair = await directory!.ofOrganization(organization.id);
          if (!pair) throw new Error("The TI's TAO has no certificate registry yet.");
          const purpose = role === 'A' ? 'governance_role_a' : 'governance_role_b';
          const key = await ebsi.ledgerSigner(organization.id, purpose);
          const other = await database.query(
            `SELECT 1 FROM issuer_signing_keys WHERE kms_key_id=$1 AND (organization_id<>$2 OR purpose<>$3)`,
            [key.keyId, organization.id, purpose],
          );
          if (other.rowCount)
            throw new Error('A body role key cannot share another signing purpose.');
          return auditedLedgerSigner(database, key, {
            keyId: key.keyId,
            purpose,
            chainId,
            deployment: { governance: pair.governance, registry: pair.registry },
          });
        })().catch((error) => {
          roleSigners.delete(cacheKey);
          throw error;
        });
        roleSigners.set(cacheKey, signer);
      }
      return signer;
    }
    const proposerOf = (issuerDid: string) => roleKey(issuerDid, 'A');
    const signersFor = async (issuerDid: string) => ({
      proposer: await roleKey(issuerDid, 'A'),
      approver: await roleKey(issuerDid, 'B'),
    });
    const adapters = new Map<string, ReturnType<typeof pairAdapters>>();
    /**
     * The adapters of one TAO's pair.
     * @param pair - The pair.
     * @returns Its registry, emergency, governance and console adapters.
     */
    function pairAdapters(pair: TaoContracts) {
      return {
        pair,
        ledger: governanceLedger({
          provider,
          signerFor: proposerOf,
          chainId,
          address: pair.registry,
          confirmations,
        }),
        emergency: emergencyLedger({
          chainId,
          address: pair.registry,
          provider,
          signerFor: proposerOf,
          fromBlock: pair.block,
          confirmations,
        }),
        actions: governanceActions({
          chainId,
          address: pair.governance,
          registry: pair.registry,
          provider,
          signersFor,
          fromBlock: pair.block,
          confirmations,
        }),
        console: consoleLedger({
          chainId,
          address: pair.governance,
          registry: pair.registry,
          provider,
          signersFor: async (issuerDid, role) => roleKey(issuerDid, role as 'A' | 'B'),
        }),
      };
    }
    /**
     * The adapters of a pair, made once.
     * @param pair - The pair.
     * @returns Its adapters.
     */
    function adaptersOf(pair: TaoContracts) {
      let made = adapters.get(pair.governance);
      if (!made) adapters.set(pair.governance, (made = pairAdapters(pair)));
      return made;
    }
    /**
     * The adapters of a TI's TAO's pair.
     * @param issuerDid - The TI.
     * @returns Its TAO's adapters.
     * @throws Error while the TAO has no pair.
     */
    async function forIssuer(issuerDid: string) {
      const pair = await directory!.ofIssuer(issuerDid);
      if (!pair) throw new Error(`The TAO of ${issuerDid} has no certificate registry yet.`);
      return adaptersOf(pair);
    }
    const ledger: CertificateLedger = {
      chainId,
      contractFor: async (issuerDid) => (await forIssuer(issuerDid)).pair.registry,
      ensureRegistered: async (record) =>
        (await forIssuer(record.issuer)).ledger.ensureRegistered(record),
      status: async (statusKey, issuerDid) =>
        (await forIssuer(issuerDid)).ledger.status(statusKey, issuerDid),
    };
    const emergency: EmergencyLedger = {
      chainId,
      contractFor: async (issuerDid) => (await forIssuer(issuerDid)).pair.registry,
      suspend: async (record) => (await forIssuer(record.issuerDid)).emergency.suspend(record),
    };
    const actions: GovernanceActions = {
      chainId,
      contractFor: async (issuerDid) => (await forIssuer(issuerDid)).pair.governance,
      advance: async (proposal) => (await forIssuer(proposal.issuerDid)).actions.advance(proposal),
      withdraw: async (proposal, reasonHash) =>
        (await forIssuer(proposal.issuerDid)).actions.withdraw(proposal, reasonHash),
    };
    const consoleLedgers: ConsoleLedgers = {
      forIssuer: async (issuerDid) => (await forIssuer(issuerDid)).console,
      forContract: async (address) => {
        const pair = await directory!.byContract(address);
        return pair ? adaptersOf(pair).console : undefined;
      },
      all: async () => (await directory!.all()).map((pair) => adaptersOf(pair).console),
    };
    // A verifier trusts a registry a licence names when the chain shows it is the TAO's: through
    // EBSI's Proxy Factory, or without one configured, as a pair recorded here.
    const registries: CertificateRegistries = factory
      ? certificateRegistries({
          provider,
          chainId,
          factory,
          templates,
          cacheSeconds: Number(env.PLR_TRUST_CACHE_SECONDS ?? 600),
        })
      : {
          chainId,
          /**
           * Accept a registry recorded here as the TAO's.
           * @param contract - The registry a credential names.
           * @param taoDid - The TAO that accredited its issuer.
           * @returns Completion when it is that TAO's recorded registry.
           */
          async trust(contract, taoDid) {
            const pair = await directory!.byContract(contract);
            if (!pair || pair.registry !== getAddress(contract) || pair.taoDid !== taoDid)
              throw new UntrustedRegistry('The registry is not a TAO pair recorded here.');
          },
          status: async (contract, statusKey) =>
            adaptersOf((await directory!.byContract(contract))!).ledger.status(statusKey, ''),
        };
    const deliverApprovedCases = postgresGovernanceDelivery(database, actions, protection);
    const authorization = postgresAuthorizationSigning(
      database,
      postgresKmsIssuerSigning(database, kms, trust.assertionKey, database),
      env.DID ?? env.PLR_ISSUER_DID ?? '',
    );
    const issuer = createIssuer(database, {
      authorization,
      protection,
      publicOrigin: publicOrigin.href,
      ledger,
      ledgerStatusSchema: ledgerStatusSchema.href,
      signingKey: postgresKmsIssuerSigning(database, kms, trust.assertionKey, database),
      ensureAccredited: accreditationGuard ?? trust.ensureAccredited,
      ensureIssuer,
      validateCredential: tsrCredentialValidation(registry),
      accreditationAddress: trust.accreditationAddress,
      schemaAddress: registry.address,
    });
    const verification = await configuredVerification(
      database,
      {
        ledger: registries,
        protection,
        signing: authorization,
        origin: publicOrigin.origin,
      },
      env,
    );
    return {
      ...issuer,
      verification,
      ledgerSignerAddresses: async () => {
        const { rows } = await database.query(
          "SELECT public_jwk FROM issuer_signing_keys WHERE purpose IN ('governance_role_a','governance_role_b','ledger_transactions')",
        );
        return rows.map((row) => jwkAddress(row.public_jwk));
      },
      governance: postgresConsoleGovernance(database, {
        ledgers: consoleLedgers,
        consoleRoles: (env.PLR_GOVERNANCE_CONSOLE_ROLES ?? 'A,B')
          .split(',')
          .map((role) => role.trim().toUpperCase()),
      }),
      auditProtection: protection,
      audit: postgresAudit(database, protection),
      statusProposals: postgresStatusProposals(database, { protection }),
      deliverApprovedCases,
      emergencySuspend: postgresEmergencySuspension(database, { protection }),
      deliverEmergencySuspensions: postgresEmergencyDelivery(database, emergency, protection),
      listCertificates: postgresCertificateList(database, protection),
      refreshStanding: postgresStandingRefresh(database, {
        status: (key, issuerDid) => ledger.status(key, issuerDid),
      }),
      contracts: directory,
      /**
       * Release resources owned by the configured issuance runtime.
       *
       * @returns Completion after closing owned clients/providers.
       */
      async close() {
        try {
          await verification.close();
        } finally {
          ebsi.close();
          protection.close?.();
        }
      },
    };
  } catch (error) {
    ebsi.close();
    protection.close?.();
    throw error;
  }
}
