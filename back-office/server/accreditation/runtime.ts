import { enqueueCommitted } from '../background/queue.ts';
import { configuredFieldProtection } from '../keys/field-protection.ts';
import type { Pool } from 'pg';
import type { trustedSchemaRegistry } from '../schemas/tsr.ts';
import { ceremonyKmsClient, kmsKeyCeremony } from '../keys/kms-provider.ts';
import { ebsiIssuerTrust } from '../issuance/ebsi-trust.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { postgresOrganizationOnboarding, type OrganizationPublication } from './onboarding.ts';
import { postgresAccreditationWithdrawal } from './withdrawal.ts';
import { postgresAccreditation } from './revalidation.ts';
import { accreditationSchemaId, supportOfficeSchemaPublication } from '../schemas/publication.ts';
import { configuredEbsi } from '../ebsi/runtime.ts';
import { RegistryRefusal } from '../ebsi/publisher.ts';
import { auditedLedgerSigner } from '../keys/ledger-signing.ts';
import { tiGovernanceSetup, tiRules } from '../lifecycle/ti-governance.ts';

/**
 * Compose organization/schema registry integrations independently of credential collection.
 * @param database - PostgreSQL pool.
 * @param schemas - Trusted TSR reader/address builder.
 * @param env - Existing deployment settings.
 * @returns Organization callbacks, schema publication hooks, accreditation state and owned-resource cleanup.
 * @throws Error for invalid registry, KMS or trust configuration.
 * @remarks Outside explicit mock mode, EBSI writes require manual publication.
 */
export function configuredOrganizations(
  database: Pool,
  schemas: ReturnType<typeof trustedSchemaRegistry>,
  env = process.env,
) {
  const protection = configuredFieldProtection(database, env);
  const did = env.DID ?? env.PLR_ISSUER_DID ?? '';
  const tir = env.PLR_TIR_URL ?? 'https://api.ebsi.eu/v1/issuers-registry';
  const kms = env.AWS_REGION ? ceremonyKmsClient(env) : undefined;
  const deployment =
    env.PLR_GOVERNANCE_CONTRACT && env.PLR_CERTIFICATE_REGISTRY
      ? { governance: env.PLR_GOVERNANCE_CONTRACT, registry: env.PLR_CERTIFICATE_REGISTRY }
      : undefined;
  // Publication in EBSI's registries is automated only with the development Support Office;
  // real EBSI writes remain manual.
  const ebsi = env.PLR_EBSI_MOCK_URL
    ? configuredEbsi(database, env, deployment ? [deployment.governance, deployment.registry] : [])
    : undefined;
  const governance =
    ebsi && deployment
      ? tiGovernanceSetup(database, {
          governance: deployment.governance,
          provider: ebsi.provider,
          /**
           * The TAO's ledger key, as an audited signer limited to the governance setup.
           * @param organizationId - TAO organization UUID.
           * @returns The audited signer.
           */
          async taoSigner(organizationId) {
            const signer = await ebsi.ledgerSigner(organizationId, 'ledger_transactions');
            return auditedLedgerSigner(database, signer, {
              keyId: signer.keyId,
              purpose: 'ledger_transactions',
              chainId: ebsi.chainId,
              deployment,
            });
          },
          rules: tiRules(env.PLR_TI_GOVERNANCE_CONFIG),
          supervisorDid: env.PLR_SUPERVISOR_DID || undefined,
        })
      : undefined;
  const publication: OrganizationPublication | undefined =
    ebsi?.publisher && ebsi.supportOffice
      ? {
          ebsi,
          tirUrl: tir.replace(/\/+$/, ''),
          accreditationSchema: schemas.address(accreditationSchemaId),
          governance,
        }
      : undefined;
  const trust =
    env.PLR_DIDR_URL && env.PLR_TRUSTED_ROOT_DIDS
      ? ebsiIssuerTrust({
          tirUrl: tir,
          didRegistryUrl: env.PLR_DIDR_URL,
          didRegistryContract: env.PLR_DIDR_CONTRACT,
          trustedRoots: env.PLR_TRUSTED_ROOT_DIDS.split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        })
      : undefined;
  const accreditation = postgresAccreditation(database, {
    issuerDid: did,
    tirUrl: tir,
    schemaAddress: schemas.address,
    check:
      trust?.ensureAccredited ??
      (async () => {
        throw new IssuanceError(503, 'AccreditationUnavailable', 'Issuer trust is not configured.');
      }),
    maxAgeHours: Number(env.PLR_ACCREDITATION_MAX_AGE_HOURS ?? 72),
    required: env.PLR_REQUIRE_ACCREDITATION !== 'false',
    defaultSchema: env.PLR_ACCREDITATION_SCHEMA,
  });
  const onboarding = postgresOrganizationOnboarding(database, {
    keys: kms ? kmsKeyCeremony(kms) : undefined,
    publication,
    schemaAddress: schemas.address,
  });
  const withdrawals = postgresAccreditationWithdrawal(
    database,
    publication &&
      (async (organizationId: string) => {
        const {
          rows: [organization],
        } = await database.query(
          'SELECT did,kind,parent_id,tir_attribute_id FROM accredited_organizations WHERE id=$1',
          [organizationId],
        );
        if (
          !organization?.did ||
          organization.kind === 'rtao' ||
          !/^0x[0-9a-f]{64}$/.test(organization.tir_attribute_id ?? '')
        )
          return;
        try {
          await publication.ebsi.publisher!.revoke(
            await publication.ebsi.actor(organization.parent_id),
            organization.did,
            organization.tir_attribute_id,
          );
        } catch (error) {
          // An accreditor revoked first can no longer revoke: its revocation already broke
          // the chain for everything below it.
          if (!(
            error instanceof RegistryRefusal &&
            ['PolicyNotTaoOrRootTao', 'TrustChainBroken'].includes(error.reason)
          ))
            throw error;
        }
      }),
  );
  // Publishing a TI in development takes a dozen ledger transactions, longer than a registering
  // Wallet or an issuing operator waits: the worker does it, and asking again queues it again.
  // Elsewhere onboarding only creates the TI's keys, at once.
  const onboardIssuer = publication
    ? (organizationId: string) => enqueueCommitted({ operation: 'onboard-issuer', organizationId })
    : onboarding.onboard;
  return {
    accreditation,
    onboarding,
    onboardIssuer,
    withdrawals,
    invitationOptions: {
      invitationDays: Number(env.PLR_INVITATION_DAYS ?? 14),
      maxAccreditationDays: Number(env.PLR_TI_ACCREDITATION_MAX_DAYS ?? 1826),
      governanceEnabled: Boolean(env.PLR_GOVERNANCE_CONTRACT),
      protection,
      onboard: onboardIssuer,
      refresh: onboarding.refresh,
      withdraw: (organizationId: string) =>
        enqueueCommitted({ operation: 'withdraw-accreditation', organizationId }),
      reportIntegrationError: (operation: string) =>
        console.error(`Organization integration pending: ${operation}`),
    },
    governance,
    ebsi,
    schemaOptions: {
      publish: ebsi?.supportOffice ? supportOfficeSchemaPublication(ebsi.supportOffice) : undefined,
      /**
       * Widen live TI coverage and revalidate the newly published type.
       * @param type - Credential type just registered in the TSR.
       * @returns Completion after best-effort TI refresh and trust checks.
       * @throws Database errors; individual registry refresh failures are logged and retried by explicit synchronization.
       */
      async registered(type: string) {
        const { rows } = await database.query(
          `SELECT o.id FROM accredited_organizations o JOIN organization_certificate_schemas g ON g.organization_id=o.id
          JOIN certificate_schemas s ON s.id=g.schema_id WHERE o.kind='ti' AND o.did IS NOT NULL AND o.revoked_at IS NULL AND s.credential_type=$1`,
          [type],
        );
        for (const row of rows) {
          try {
            await onboarding.refresh(row.id);
          } catch {
            console.error('TI accreditation refresh pending.');
          }
        }
        await accreditation.revalidateAll(type);
      },
      reportIntegrationError: (operation: string) =>
        console.error(`Schema integration pending: ${operation}`),
    },
    /**
     * Release the dedicated ceremony client owned by this runtime.
     * @returns No return value.
     */
    close() {
      kms?.destroy();
      ebsi?.close();
      protection.close();
    },
  };
}
