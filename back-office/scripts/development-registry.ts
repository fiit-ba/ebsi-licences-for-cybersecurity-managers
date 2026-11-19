import type { Pool } from 'pg';
import { postgresKeyManagement } from '../server/keys/management.ts';
import { ceremonyKmsClient, kmsKeyCeremony } from '../server/keys/kms-provider.ts';
import { didRegistry } from '../server/ebsi/did-registry.ts';
import { configuredOrganizations } from '../server/accreditation/runtime.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';
import { registerDevelopmentSchemas } from '../server/schemas/publication.ts';
import { configuredSchemaIds, registrySchemas } from '../server/schemas/registry-schemas.ts';
import type { DevelopmentSupportOffice } from '../server/ebsi/support-office.ts';
import { developmentSchemaDocument, developmentSchemaId } from './development-schema.ts';
import { developmentWallet } from '../server/accreditation/development-wallet.ts';

/**
 * Register the development schemas as the Support Office, then read the configured ones back
 * from the registry, as the server does at startup.
 * @param database - Installation pool.
 * @param supportOffice - The development Support Office.
 * @param env - Development environment with `PLR_TSR_URL` and `PLR_TSR_SCHEMAS`.
 * @param registered - What to do when a type gains a version (TI accreditations cover it).
 * @returns The number of schemas read from the registry.
 * @throws Configuration, registry or database errors.
 */
async function developmentSchemas(
  database: Pool,
  supportOffice: DevelopmentSupportOffice,
  env: NodeJS.ProcessEnv,
  registered?: (credentialType: string) => Promise<void>,
) {
  await registerDevelopmentSchemas(supportOffice, [
    { id: developmentSchemaId, document: developmentSchemaDocument },
  ]);
  const ids = configuredSchemaIds(env.PLR_TSR_SCHEMAS);
  // Without ids the stored schemas stay as they are, as the server does.
  if (!ids.length) return 0;
  await registrySchemas(database, trustedSchemaRegistry(env.PLR_TSR_URL!), {
    ids,
    registered,
  }).synchronize();
  return ids.length;
}

/**
 * Bind the registry's DIDs and publish its RootTAO in the development EBSI registries.
 * @param database - Existing new-product database pool.
 * @param env - Explicit development Core API, Support Office and KMS environment.
 * @returns The registry DID and the TAO's ledger address, which must own the governance
 * contracts before TIs are set up on them.
 * @throws Configuration, database, KMS, registry or uncertain-creation errors.
 * @remarks Development only: hosted installations publish through EBSI's own onboarding.
 */
export async function initializeDevelopmentRegistry(database: Pool, env = process.env) {
  if (!env.PLR_EBSI_MOCK_URL || !env.PLR_EBSI_URL || !env.PLR_DIDR_URL || !env.PLR_TSR_URL)
    throw new Error('Configure the development Support Office, Core API, DIDR and TSR.');
  const did = env.PLR_ISSUER_DID ?? env.DID;
  if (!did) throw new Error('Configure the registry issuer DID.');
  const kms = ceremonyKmsClient(env);
  const organizations = configuredOrganizations(
    database,
    trustedSchemaRegistry(env.PLR_TSR_URL),
    env,
  );
  try {
    const root = (
      await database.query(
        "SELECT id,account_id FROM accredited_organizations WHERE kind='rtao' AND account_id IS NOT NULL AND revoked_at IS NULL",
      )
    ).rows[0];
    if (!root) throw new Error('Bootstrap the first RootTAO administrator first.');
    const store = postgresKeyManagement(database, {
      kms: kmsKeyCeremony(kms),
      dids: didRegistry({ identifiersUrl: env.PLR_DIDR_URL }),
    });
    await store.identity(root.account_id, root.id, did);
    await developmentSchemas(database, organizations.ebsi!.supportOffice!, env);
    await organizations.onboarding.ensureAuthority(root.id);
    return { registry: did };
  } finally {
    kms.destroy();
    organizations.close();
  }
}

/**
 * The demonstration organizations' own wallets, which the development bootstrap plays for them:
 * the TAO the governance contracts were deployed for (its DID is `PLR_GOVERNANCE_TAO_DID`) and
 * its TI. Any other TAO or TI brings its own DID and wallet.
 * @param database - Installation pool.
 * @param organizations - The configured organizations, with the development EBSI service.
 * @param env - Development environment with `PLR_GOVERNANCE_TAO_DID`.
 * @returns The two wallets.
 * @throws Error without the development EBSI service or the TAO's DID.
 */
export function demoWallets(
  database: Pool,
  organizations: ReturnType<typeof configuredOrganizations>,
  env = process.env,
) {
  if (!organizations.publication)
    throw new Error('The demonstration wallets need the development EBSI service.');
  if (!env.PLR_GOVERNANCE_TAO_DID) throw new Error('Configure PLR_GOVERNANCE_TAO_DID.');
  return {
    tao: developmentWallet(database, organizations.publication, 0, env.PLR_GOVERNANCE_TAO_DID),
    ti: developmentWallet(database, organizations.publication, 1),
  };
}

/**
 * Publish the installation's schemas, authorities and TIs in the development registries, and
 * set TIs up on the governance contract, without rotating keys.
 * @param database - Existing installation pool; no identity or audit data is cleared.
 * @param env - Explicit development Core API, Support Office and KMS settings.
 * @returns Counts of synchronized versions/issuers and any pending integration work.
 * @throws Configuration, database or registry errors; pending work is returned for CLI refusal.
 */
export async function synchronizeDevelopmentRegistry(database: Pool, env = process.env) {
  if (!env.PLR_EBSI_MOCK_URL || !env.PLR_TIR_URL || !env.PLR_TSR_URL || !env.PLR_EBSI_URL)
    throw new Error(
      'Configure the development Support Office, Core API, TIR and TSR before synchronization.',
    );
  const organizations = configuredOrganizations(
    database,
    trustedSchemaRegistry(env.PLR_TSR_URL),
    env,
  );
  try {
    const versions = await developmentSchemas(
      database,
      organizations.ebsi!.supportOffice!,
      env,
      organizations.schemaOptions.registered,
    );
    for (const { id } of (
      await database.query(
        "SELECT id FROM accredited_organizations WHERE kind='rtao' AND account_id IS NOT NULL AND revoked_at IS NULL",
      )
    ).rows)
      await organizations.onboarding.ensureAuthority(id);
    // The demonstration TAO and TI do their part with the wallets bootstrap plays for them;
    // every other organization does it with its own, and is only issued and checked here.
    const wallets = env.PLR_GOVERNANCE_TAO_DID
      ? demoWallets(database, organizations, env)
      : undefined;
    const demo = new Map(
      wallets ? [wallets.tao, wallets.ti].map((wallet) => [wallet.did, wallet]) : [],
    );
    const { rows } =
      await database.query(`SELECT o.id,o.kind,o.did,o.parent_id FROM accredited_organizations o
    JOIN accredited_organizations parent ON parent.id=o.parent_id LEFT JOIN accredited_organizations root ON root.id=parent.parent_id
    WHERE o.kind IN ('tao','ti') AND o.account_id IS NOT NULL AND o.did<>'' AND o.revoked_at IS NULL
      AND parent.revoked_at IS NULL AND root.revoked_at IS NULL ORDER BY o.kind<>'tao',o.id`);
    let completed = 0;
    let pending = 0;
    let governancePending = 0;
    for (const row of rows) {
      try {
        const wallet = demo.get(row.did);
        await wallet?.register(row.parent_id);
        await organizations.onboarding.onboard(row.id);
        await wallet?.complete(row.id);
        const { accredited } = await organizations.onboarding.check(row.id);
        if (row.kind !== 'ti') continue;
        if (!accredited) {
          pending++;
          continue;
        }
        completed++;
        const setup = await organizations.governance?.ensure(row.id);
        if (setup?.state === 'pending') governancePending++;
      } catch (error) {
        if (row.kind === 'ti') pending++;
        console.error('An organization remains pending:', (error as Error).message);
      }
    }
    // Reapply committed withdrawals too; never republish a revoked TI as trusted.
    await database.query(
      'UPDATE accreditation_withdrawals SET tir_completed_at=NULL,attempted_at=NULL',
    );
    let pendingWithdrawals = Number(
      (
        await database.query(
          'SELECT count(*) FROM accreditation_withdrawals WHERE tir_completed_at IS NULL',
        )
      ).rows[0].count,
    );
    while (pendingWithdrawals) {
      await organizations.withdrawals.deliver();
      const remaining = Number(
        (
          await database.query(
            'SELECT count(*) FROM accreditation_withdrawals WHERE tir_completed_at IS NULL',
          )
        ).rows[0].count,
      );
      if (remaining === pendingWithdrawals) break;
      pendingWithdrawals = remaining;
    }
    return {
      schema_versions: versions,
      issuers: completed,
      pending,
      governance_pending: governancePending,
      withdrawals_pending: pendingWithdrawals,
    };
  } finally {
    organizations.close();
  }
}
