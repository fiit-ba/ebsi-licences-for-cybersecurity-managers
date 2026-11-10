import { KMSClient } from '@aws-sdk/client-kms';
import { bootstrapFieldKeys } from '../server/keys/field-bootstrap.ts';
import pg from 'pg';
import { bootstrapRootAdministrator } from '../server/identity/administration/bootstrap.ts';
import { postgresOperatorManagement } from '../server/identity/administration/management.ts';
import { postgresInvitations } from '../server/accreditation/invitations.ts';
import { configuredOrganizations } from '../server/accreditation/runtime.ts';
import { postgresSchemaManagement } from '../server/schemas/management.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';
import {
  initializeDevelopmentRegistry,
  initializeDevelopmentTao,
  synchronizeDevelopmentRegistry,
} from './development-registry.ts';
import { developmentSchema } from './development-schema.ts';

if (process.env.BACK_OFFICE_DEVELOPMENT !== 'true' || !process.env.PLR_EBSI_MOCK_URL)
  throw new Error(
    'Development seeds require the explicit local Compose environment; use bootstrap:admin for a hosted installation.',
  );
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const fieldKms = new KMSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.PLR_KMS_ENDPOINT_URL,
  maxAttempts: 1,
});

const lock = await database.connect();
const registry = trustedSchemaRegistry(process.env.PLR_TSR_URL!);
const integrations = configuredOrganizations(database, registry);
// Onboard each TI here rather than in the worker, so nothing races the synchronization below.
const invitations = postgresInvitations(database, {
  ...integrations.invitationOptions,
  onboard: integrations.onboarding.onboard,
});
const management = postgresOperatorManagement(database);
const password = process.env.PLR_DEV_PASSWORD ?? 'Atest-2026!Demo';
const rootName = 'Národný bezpečnostný úrad';
const taoName = 'Ministerstvo investícií, regionálneho rozvoja a informatizácie SR';
const tiName =
  'Slovenská technická univerzita v Bratislave, Fakulta informatiky a informačných technológií';

/**
 * Read the exact named seed account, without changing its password or activation state.
 * @param username - Fixed local demonstration username.
 * @returns Existing account ID or undefined.
 * @throws Database errors.
 */
async function account(username: string): Promise<number | undefined> {
  return (await database.query('SELECT id FROM operator_accounts WHERE username=$1', [username]))
    .rows[0]?.id;
}

/**
 * Add explicitly seeded role groups while retaining all existing account properties.
 * @param actor - Existing initial RootTAO/administrator.
 * @param id - Current demonstration account.
 * @param names - Development business/signer memberships to restore.
 * @returns Completion when group memberships already match or are saved once.
 * @throws Existing staff/group authorization, validation and database errors.
 * @remarks This explicit development seed may restore its named demo roles, but never reactivates accounts.
 */
async function roles(actor: number, id: number, names: string[]) {
  const current = await management.staff.read(actor, id);
  if (!current.active)
    throw new Error('A demonstration account was disabled; bootstrap will not reactivate it.');
  const groupIds = [...current.group_ids];
  for (const name of names) {
    let group = (await database.query('SELECT id FROM operator_groups WHERE name=$1', [name]))
      .rows[0];
    group ??= await management.groups.save(actor, { name, permission_ids: [] });
    if (!groupIds.includes(group.id)) groupIds.push(group.id);
  }
  if (groupIds.length === current.group_ids.length) return;
  const {
    username,
    email,
    first_name,
    last_name,
    active,
    is_staff,
    is_superuser,
    permission_ids,
    version,
  } = current;
  await management.staff.save(actor, {
    account_id: id,
    version,
    username,
    email,
    first_name,
    last_name,
    active,
    is_staff,
    is_superuser,
    group_ids: groupIds,
    permission_ids,
  });
}

/**
 * Resume a selected seed organization through the same invitation/registration services as consumers.
 * @param actor - Direct parent account ID.
 * @param parent - Expected direct parent organization UUID.
 * @param username - Development account created only if absent.
 * @param name - Stable demonstration organization name.
 * @param kind - Expected TAO or TI kind.
 * @returns Registered account and organization identifiers.
 * @throws Ownership conflicts, revoked/expired hierarchy, existing domain refusals or provider errors.
 */
async function organization(
  actor: number,
  parent: string,
  username: string,
  name: string,
  kind: 'tao' | 'ti',
) {
  const existing = (
    await database.query(
      'SELECT o.*,a.username FROM accredited_organizations o LEFT JOIN operator_accounts a ON a.id=o.account_id WHERE o.parent_id=$1 AND o.name=$2',
      [parent, name],
    )
  ).rows;
  if (existing.length > 1)
    throw new Error('Ambiguous demonstration organization; resolve it explicitly.');
  const prior = existing[0];
  if (
    prior &&
    (prior.kind !== kind || prior.revoked_at || (prior.account_id && prior.username !== username))
  )
    throw new Error('The existing demonstration organization changed ownership or was revoked.');
  if (!prior?.account_id) {
    if (await account(username))
      throw new Error('A seed username already belongs to another account.');
    const invitation = prior
      ? await invitations.renew(actor, { organization_id: prior.id })
      : await invitations.select(actor, {
          name,
          schemas: [developmentSchema.credential_type],
          ...(kind === 'ti'
            ? { accredited_until: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) }
            : {}),
        });
    await invitations.register({ invitation: invitation.invitation, username, password, kind });
  }
  const result = (
    await database.query(
      'SELECT o.id,o.account_id FROM accredited_organizations o JOIN operator_accounts a ON a.id=o.account_id WHERE a.username=$1 AND o.parent_id=$2',
      [username, parent],
    )
  ).rows[0];
  if (!result)
    throw new Error('The seed organization is not registered under its expected parent.');
  return { id: result.id as string, account: result.account_id as number };
}

try {
  await lock.query('SELECT pg_advisory_lock(780264160)');
  try {
    await bootstrapFieldKeys(database, fieldKms, {
      development: true,
      kmsKeyId: process.env.PLR_FIELD_KMS_KEY_ID || undefined,
    });
  } finally {
    fieldKms.destroy();
  }

  let supervisor = await account('supervisor');
  if (!supervisor) {
    if ((await database.query('SELECT 1 FROM operator_accounts LIMIT 1')).rowCount)
      throw new Error(
        'This database already has accounts; development bootstrap will not adopt another installation.',
      );
    supervisor = (
      await bootstrapRootAdministrator(database, {
        username: 'supervisor',
        email: 'supervisor@example.test',
        password,
        organization_name: rootName,
      })
    ).account_id;
  }
  const root = (
    await database.query(
      "SELECT id,name FROM accredited_organizations WHERE kind='rtao' AND account_id=$1 AND revoked_at IS NULL",
      [supervisor],
    )
  ).rows[0];
  if (!root || root.name !== rootName)
    throw new Error('The existing administrator is not this development seed RootTAO.');
  await roles(supervisor, supervisor, ['plr_rtao', 'plr_auditor']);
  const registryIdentity = await initializeDevelopmentRegistry(database);
  const schemas = postgresSchemaManagement(database, registry, integrations.schemaOptions);
  if (
    !(
      await database.query('SELECT 1 FROM certificate_schemas WHERE credential_type=$1', [
        developmentSchema.credential_type,
      ])
    ).rowCount
  )
    await schemas.propose(supervisor, developmentSchema);
  // Retry an unpublished initial draft with its CURRENT fields, not the defaults;
  // an already published schema and later operator drafts remain untouched.
  const published = await database.query(
    'SELECT 1 FROM certificate_schema_versions v JOIN certificate_schemas s ON s.id=v.schema_id WHERE s.credential_type=$1 AND v.registered_at IS NOT NULL',
    [developmentSchema.credential_type],
  );
  if (!published.rowCount) {
    const draft = (
      await database.query(
        'SELECT s.name_sk,s.name_en,v.fields FROM certificate_schemas s JOIN certificate_schema_versions v ON v.schema_id=s.id WHERE s.credential_type=$1 AND s.retired_at IS NULL ORDER BY v.version DESC LIMIT 1',
        [developmentSchema.credential_type],
      )
    ).rows[0];
    if (!draft) throw new Error('No usable initial development schema draft exists.');
    await schemas.propose(supervisor, {
      ...draft,
      credential_type: developmentSchema.credential_type,
    });
  }
  const tao = await organization(supervisor, root.id, 'mirri', taoName, 'tao');
  // The governance contracts were deployed for this TAO's DID; its ledger key must own them
  // before its TIs can be set up there (bootstrap transfers ownership, then synchronizes).
  const taoIdentity = await initializeDevelopmentTao(database, supervisor, tao.id);
  const ti = await organization(tao.account, tao.id, 'alice', tiName, 'ti');
  await roles(supervisor, ti.account, [
    'plr_issuer',
    'plr_status_manager',
    'plr_verifier',
    'plr_governance_a',
  ]);
  let bob = await account('bob');
  if (!bob)
    bob = (
      await management.staff.save(supervisor, {
        username: 'bob',
        email: 'bob@example.test',
        password,
        active: true,
        group_ids: [],
        permission_ids: [],
      })
    ).id;
  await roles(supervisor, bob, ['plr_status_manager', 'plr_verifier', 'plr_governance_b']);
  const synchronized = await synchronizeDevelopmentRegistry(database);
  if (synchronized.pending || synchronized.withdrawals_pending)
    throw new Error(
      'Registry work is pending; inspect the durable key/withdrawal request before retrying.',
    );
  console.log(
    JSON.stringify({
      ...registryIdentity,
      tao: taoIdentity,
      synchronized,
      accounts: ['alice', 'bob', 'supervisor', 'mirri'],
      origin: process.env.BACK_OFFICE_PUBLIC_ORIGIN,
      ledger: {
        governance: process.env.PLR_GOVERNANCE_CONTRACT,
        registry: process.env.PLR_CERTIFICATE_REGISTRY,
        chainId: Number(process.env.PLR_LEDGER_CHAIN_ID),
      },
    }),
  );
} finally {
  await lock.query('SELECT pg_advisory_unlock(780264160)');
  lock.release();
  integrations.close();
  await database.end();
}
