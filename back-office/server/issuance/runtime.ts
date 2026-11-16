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
import type { Signer } from 'ethers';
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
  'PLR_GOVERNANCE_CONTRACT',
  'PLR_CERTIFICATE_REGISTRY',
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
  // The certificate registry keeps each record; its governance decides changes to it.
  const deployment = {
    governance: env.PLR_GOVERNANCE_CONTRACT!,
    registry: env.PLR_CERTIFICATE_REGISTRY!,
  };
  // Every signed transaction goes through EBSI's Ledger API with a token for its TI.
  const ebsi = configuredEbsi(database, env, [deployment.governance, deployment.registry])!;
  const { provider, kms } = ebsi;
  const confirmations = Number(env.BACK_OFFICE_LEDGER_CONFIRMATIONS ?? 1);
  const fromBlock = Number(env.BACK_OFFICE_GOVERNANCE_DEPLOYMENT_BLOCK ?? 0);
  try {
    const roleSigners = new Map<string, Promise<Signer>>();
    /**
     * Resolve the issuing TI's A or B governance key when signature work needs it.
     * @param issuerDid - The TI whose certificate the transaction concerns.
     * @param role - Body role: A proposes, registers and suspends at once; B approves.
     * @returns One pinned, purpose-bound audited KMS signer per key and process.
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
            deployment,
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
    const ledger = governanceLedger({
      provider,
      signerFor: proposerOf,
      chainId,
      address: deployment.registry,
      confirmations,
    });
    const emergency = emergencyLedger({
      chainId,
      address: deployment.registry,
      provider,
      signerFor: proposerOf,
      fromBlock,
      confirmations,
    });
    const deliverApprovedCases = postgresGovernanceDelivery(
      database,
      governanceActions({
        chainId,
        address: deployment.governance,
        registry: deployment.registry,
        provider,
        signersFor: async (issuerDid) => ({
          proposer: await roleKey(issuerDid, 'A'),
          approver: await roleKey(issuerDid, 'B'),
        }),
        fromBlock,
        confirmations,
      }),
      protection,
    );
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
        ledger,
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
        ledger: consoleLedger({
          chainId,
          address: deployment.governance,
          registry: deployment.registry,
          provider,
          signersFor: async (issuerDid, role) => roleKey(issuerDid, role),
        }),
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
      refreshStanding: postgresStandingRefresh(database, { status: (key) => ledger.status(key) }),
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
