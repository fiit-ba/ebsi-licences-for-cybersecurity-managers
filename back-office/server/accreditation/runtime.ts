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
import { ebsiSchemaIds } from '../schemas/ebsi-schemas.ts';
import { configuredEbsi } from '../ebsi/runtime.ts';
import { RegistryRefusal } from '../ebsi/publisher.ts';
import { auditedLedgerSigner } from '../keys/ledger-signing.ts';
import { tiGovernanceSetup, tiRules } from '../lifecycle/ti-governance.ts';
import { getAddress } from 'ethers';
import {
  contractTemplates,
  factoryDeployments,
  taoContractDeployment,
  taoContractDirectory,
  type TaoContractDirectory,
} from '../lifecycle/tao-contracts.ts';
import { DidResolutionError, didRegistry } from '../ebsi/did-registry.ts';

/**
 * The schemas the trust chain's credentials name, in the configured Trusted Schemas Registry.
 * @param schemas - The registry.
 * @returns EBSI's accreditation and authorisation schemas, with the IssuanceCertificate extension.
 */
export function trustChainSchemas(
  schemas: Pick<ReturnType<typeof trustedSchemaRegistry>, 'address'>,
) {
  return {
    accreditation: [
      schemas.address(ebsiSchemaIds.accreditation),
      schemas.address(ebsiSchemaIds.issuanceCertificate),
    ],
    onboarding: [schemas.address(ebsiSchemaIds.authorisation)],
  };
}

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
  // Each TAO has its own certificate registry and governance contract. A pair deployed
  // beforehand (Deploy.s.sol) becomes its TAO's; the back-office deploys every other TAO's
  // through EBSI's Proxy Factory, as the RootTAO.
  const existing =
    env.PLR_GOVERNANCE_CONTRACT && env.PLR_CERTIFICATE_REGISTRY
      ? {
          governance: env.PLR_GOVERNANCE_CONTRACT,
          registry: env.PLR_CERTIFICATE_REGISTRY,
          block: Number(env.BACK_OFFICE_GOVERNANCE_DEPLOYMENT_BLOCK ?? 0),
        }
      : undefined;
  const factory = env.PLR_PROXY_FACTORY?.trim() ? getAddress(env.PLR_PROXY_FACTORY.trim()) : '';
  let directory: TaoContractDirectory | undefined;
  let deployedByFactory: ((address: string) => Promise<boolean>) | undefined;
  // Publication in EBSI's registries is automated only with the development Support Office;
  // real EBSI writes remain manual.
  const ebsi = env.PLR_EBSI_MOCK_URL
    ? configuredEbsi(
        database,
        env,
        async (address) =>
          address === factory ||
          Boolean(await directory?.byContract(address)) ||
          Boolean(deployedByFactory && (await deployedByFactory(address))),
      )
    : undefined;
  deployedByFactory = ebsi && factory ? factoryDeployments(ebsi.provider, factory) : undefined;
  directory = ebsi
    ? taoContractDirectory(database, { existing, provider: ebsi.provider })
    : undefined;
  const contracts =
    ebsi && factory
      ? taoContractDeployment(database, {
          provider: ebsi.provider,
          factory,
          templates: contractTemplates(env.PLR_CONTRACT_TEMPLATES),
          existing,
          /**
           * The RootTAO, which holds EBSI's ProxyFactory:deployProxy policy, deploys.
           * @returns Its ledger key and DID.
           */
          async deployer() {
            const {
              rows: [root],
            } = await database.query(
              "SELECT id,did FROM accredited_organizations WHERE kind='rtao' AND revoked_at IS NULL AND did<>'' ORDER BY registered_at NULLS LAST, id LIMIT 1",
            );
            if (!root) throw new Error('No RootTAO to deploy TAO contracts.');
            const signer = await ebsi.ledgerSigner(root.id, 'ledger_transactions');
            if (ebsi.supportOffice) {
              // In development the Support Office grants what EBSI's grants on the pilot: the
              // deploy policy, and access to the Trusted Contracts (the factory among them).
              await onboarding.ensureAuthority(root.id);
              await ebsi.supportOffice.deployer(await signer.getAddress());
              await database.query(
                'UPDATE accredited_organizations SET ebsi_invoke_credential=$2 WHERE id=$1 AND ebsi_invoke_credential IS NULL',
                [root.id, await ebsi.supportOffice.invoke(root.did)],
              );
            }
            return { signer, did: root.did };
          },
          /**
           * The TAO's own ledger key owns its pair.
           * @param taoId - TAO organization UUID.
           * @returns Its ledger key.
           */
          owner: (taoId) => ebsi.ledgerSigner(taoId, 'ledger_transactions'),
        })
      : undefined;
  const governance =
    ebsi && directory && (existing || contracts)
      ? tiGovernanceSetup(database, {
          provider: ebsi.provider,
          /**
           * The TI's TAO's pair, deployed first when the back-office deploys pairs.
           * @param taoId - The TI's TAO.
           * @returns The pair, or undefined while it has none.
           */
          pairOf: async (taoId) =>
            contracts ? contracts.ensure(taoId) : directory!.ofOrganization(taoId),
          /**
           * The TAO's ledger key, as an audited signer limited to its pair.
           * @param organizationId - TAO organization UUID.
           * @param pair - The TAO's pair.
           * @returns The audited signer.
           */
          async taoSigner(organizationId, pair) {
            const signer = await ebsi.ledgerSigner(organizationId, 'ledger_transactions');
            return auditedLedgerSigner(database, signer, {
              keyId: signer.keyId,
              purpose: 'ledger_transactions',
              chainId: ebsi.chainId,
              deployment: { governance: pair.governance, registry: pair.registry },
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
          trustChainSchemas: trustChainSchemas(schemas),
          governance,
          contracts,
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
          'SELECT did,kind,parent_id,tir_attribute_id,accreditation_credential FROM accredited_organizations WHERE id=$1',
          [organizationId],
        );
        // The attribute its accreditor reserved, even if it never stored its accreditation
        // there: revoked, it can no longer store one it was issued earlier.
        let reserved: unknown;
        try {
          reserved = JSON.parse(
            Buffer.from(
              String(organization?.accreditation_credential).split('.')[1] ?? '',
              'base64url',
            ).toString(),
          ).vc?.credentialSubject?.reservedAttributeId;
        } catch {
          reserved = undefined;
        }
        const attribute = organization?.tir_attribute_id || reserved;
        if (
          !organization?.did ||
          organization.kind === 'rtao' ||
          typeof attribute !== 'string' ||
          !/^0x[0-9a-f]{64}$/.test(attribute)
        )
          return;
        try {
          await publication.ebsi.publisher!.revoke(
            await publication.ebsi.actor(organization.parent_id),
            organization.did,
            attribute,
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
  // An organization is appointed by its own DID: the DID Registry must know it.
  const dids = env.PLR_DIDR_URL ? didRegistry({ identifiersUrl: env.PLR_DIDR_URL }) : undefined;
  const didRegistered =
    dids &&
    (async (organizationDid: string) => {
      try {
        await dids.document(organizationDid);
        return true;
      } catch (error) {
        if (error instanceof DidResolutionError && !error.unavailable) return false;
        throw error;
      }
    });
  /**
   * A first issuance checks that its TI stored its accreditation in EBSI and lists the
   * back-office's keys; the TI does both itself.
   * @param organizationId - TI organization UUID.
   * @param actor - Issuing account.
   * @returns Completion when the TI is accredited in EBSI.
   * @throws Error while it is not.
   */
  async function ensureIssuer(organizationId: string, actor: number) {
    if (!(await onboarding.check(organizationId, actor)).accredited)
      throw new Error('The TI has not stored its accreditation in EBSI yet.');
  }
  return {
    accreditation,
    onboarding,
    onboardIssuer,
    ensureIssuer: publication ? ensureIssuer : undefined,
    withdrawals,
    invitationOptions: {
      invitationDays: Number(env.PLR_INVITATION_DAYS ?? 14),
      maxAccreditationDays: Number(env.PLR_TI_ACCREDITATION_MAX_DAYS ?? 1826),
      governanceEnabled: Boolean(env.PLR_GOVERNANCE_CONTRACT || env.PLR_PROXY_FACTORY),
      protection,
      didRegistered,
      onboard: onboardIssuer,
      refresh: onboarding.refresh,
      check: publication ? onboarding.check : undefined,
      withdraw: (organizationId: string) =>
        enqueueCommitted({ operation: 'withdraw-accreditation', organizationId }),
      reportIntegrationError: (operation: string) =>
        console.error(`Organization integration pending: ${operation}`),
    },
    governance,
    ebsi,
    /** What publishing in EBSI's development registries needs; undefined elsewhere. */
    publication,
    schemaOptions: {
      /**
       * Issue live TAOs' and TIs' accreditations again to cover a type that gained a version in
       * the TSR (each stores its new one itself), and revalidate the type.
       * @param type - Credential type whose new version was read from the TSR.
       * @returns Completion after best-effort TI refresh and trust checks.
       * @throws Database errors; individual registry refresh failures are logged and retried by explicit synchronization.
       */
      async registered(type: string) {
        const { rows } = await database.query(
          `SELECT o.id FROM accredited_organizations o WHERE o.kind='tao' AND o.did<>'' AND o.account_id IS NOT NULL AND o.revoked_at IS NULL
          UNION ALL
          SELECT o.id FROM accredited_organizations o JOIN organization_certificate_schemas g ON g.organization_id=o.id
          JOIN certificate_schemas s ON s.id=g.schema_id WHERE o.kind='ti' AND o.did<>'' AND o.revoked_at IS NULL AND s.credential_type=$1`,
          [type],
        );
        for (const row of rows) {
          try {
            await onboarding.refresh(row.id);
          } catch {
            console.error('Accreditation refresh pending.');
          }
        }
        await accreditation.revalidateAll(type);
      },
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
