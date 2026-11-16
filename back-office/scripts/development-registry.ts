import type { Pool } from 'pg';
import { postgresKeyManagement } from '../server/keys/management.ts';
import { ceremonyKmsClient, kmsKeyCeremony } from '../server/keys/kms-provider.ts';
import { didRegistry } from '../server/ebsi/did-registry.ts';
import { configuredOrganizations } from '../server/accreditation/runtime.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';
import { synchronizeSchemas } from '../server/schemas/publication.ts';

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
    await synchronizeSchemas(database, organizations.ebsi!.supportOffice!);
    await organizations.onboarding.ensureAuthority(root.id);
    return { registry: did };
  } finally {
    kms.destroy();
    organizations.close();
  }
}

/**
 * Bind a TAO to the DID the governance contracts were deployed for, and publish it.
 * @param database - Existing installation pool.
 * @param actor - Administrator binding the identity.
 * @param organizationId - TAO organization UUID.
 * @param env - Explicit development environment with `PLR_GOVERNANCE_TAO_DID`.
 * @returns The TAO's DID and the address of its ledger key.
 * @throws Configuration, identity, KMS or registry errors.
 */
export async function initializeDevelopmentTao(
  database: Pool,
  actor: number,
  organizationId: string,
  env = process.env,
) {
  if (!env.PLR_GOVERNANCE_TAO_DID) throw new Error('Configure PLR_GOVERNANCE_TAO_DID.');
  const kms = ceremonyKmsClient(env);
  const organizations = configuredOrganizations(
    database,
    trustedSchemaRegistry(env.PLR_TSR_URL!),
    env,
  );
  try {
    const store = postgresKeyManagement(database, {
      kms: kmsKeyCeremony(kms),
      dids: didRegistry({ identifiersUrl: env.PLR_DIDR_URL! }),
    });
    await store.identity(actor, organizationId, env.PLR_GOVERNANCE_TAO_DID);
    const tao = await organizations.onboarding.ensureAuthority(organizationId);
    return { did: tao.did, address: await tao.ledger.signer.getAddress() };
  } finally {
    kms.destroy();
    organizations.close();
  }
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
    const versions = await synchronizeSchemas(database, organizations.ebsi!.supportOffice!);
    const authorities = (
      await database.query(
        `SELECT o.id FROM accredited_organizations o WHERE o.kind IN ('rtao','tao') AND o.account_id IS NOT NULL
         AND o.revoked_at IS NULL AND (o.kind='rtao' OR o.did IS NOT NULL) ORDER BY o.kind<>'rtao',o.id`,
      )
    ).rows;
    for (const row of authorities) await organizations.onboarding.ensureAuthority(row.id);
    const { rows } = await database.query(`SELECT ti.id FROM accredited_organizations ti
    JOIN accredited_organizations tao ON tao.id=ti.parent_id JOIN accredited_organizations root ON root.id=tao.parent_id
    WHERE ti.kind='ti' AND ti.account_id IS NOT NULL AND ti.revoked_at IS NULL AND tao.revoked_at IS NULL AND root.revoked_at IS NULL ORDER BY ti.id`);
    let completed = 0;
    let governancePending = 0;
    for (const row of rows) {
      try {
        await organizations.onboarding.onboard(row.id);
        completed++;
        const setup = await organizations.governance?.ensure(row.id);
        if (setup?.state === 'pending') governancePending++;
      } catch (error) {
        console.error('A TI remains pending:', (error as Error).message);
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
      pending: rows.length - completed,
      governance_pending: governancePending,
      withdrawals_pending: pendingWithdrawals,
    };
  } finally {
    organizations.close();
  }
}
