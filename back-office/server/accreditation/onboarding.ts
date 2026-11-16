import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { KeyCeremonyProvider, CeremonyPurpose } from '../keys/kms-provider.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { accreditationCoverage } from './coverage.ts';
import type { EbsiRuntime } from '../ebsi/runtime.ts';
import type { EbsiActor, PublishedKey } from '../ebsi/publisher.ts';
import {
  accreditationCoverage as storedCoverage,
  coverageText,
  trustChainCredential,
  type AccreditationScope,
} from '../ebsi/credentials.ts';
import type { TiGovernanceSetup } from '../lifecycle/ti-governance.ts';

/** Purpose-separated keys, the DID relationships each holds, and who holds them. */
const relationships = {
  credential_signing: ['assertionMethod'],
  did_authentication: ['authentication'],
  ledger_transactions: ['capabilityInvocation', 'authentication'],
  governance_role_a: ['capabilityInvocation'],
  governance_role_b: ['capabilityInvocation'],
} as const;
/** A key purpose an onboarded organization holds, with the DID relationships it is published under. */
type OnboardingPurpose = keyof typeof relationships;
const authorityPurposes: OnboardingPurpose[] = [
  'credential_signing',
  'did_authentication',
  'ledger_transactions',
];
// Each TI signs on the governance contract with its own A and B keys (component 10.2).
const issuerPurposes: OnboardingPurpose[] = [
  ...authorityPurposes,
  'governance_role_a',
  'governance_role_b',
];

/** What publishing an organization in EBSI's registries needs; configured in development only. */
export interface OrganizationPublication {
  ebsi: EbsiRuntime;
  /** Trusted Issuers Registry base, for the `termsOfUse` links of the chain. */
  tirUrl: string;
  /** Schema of the trust chain's credentials. */
  accreditationSchema: string;
  /** Per-TI setup on the governance contract, when one is configured. */
  governance?: TiGovernanceSetup;
}

/**
 * Commit onboarding bookkeeping on its already reserved connection when available.
 * @param database - Pool used by standalone refresh operations.
 * @param connection - Session holding the per-organization onboarding lock, or undefined.
 * @param work - Atomic local bookkeeping and registry operation.
 * @returns The committed operation result.
 * @throws Operation or database errors; rollback failures may replace the original error.
 * @remarks Reusing the session prevents queued onboarding attempts from exhausting the pool.
 */
async function onboardingTransaction<T>(
  database: Pool,
  connection: PoolClient | undefined,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!connection) return transaction(database, work);
  await connection.query('BEGIN');
  try {
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
}

/**
 * Allocate a legal-entity EBSI DID using its version byte and random 128-bit identifier.
 * @returns A base58btc did:ebsi identifier.
 * @throws Crypto errors when secure random data is unavailable.
 */
function newDid() {
  const bytes = Buffer.concat([Buffer.from([1]), randomBytes(16)]);
  let value = BigInt('0x' + bytes.toString('hex'));
  let encoded = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return 'did:ebsi:z' + encoded;
}

/**
 * Create organization onboarding: purpose-separated KMS keys, and in development their
 * publication through EBSI's Core API v1 with the accreditation chain and governance setup.
 * @param database - PostgreSQL pool.
 * @param options - Dedicated KMS ceremony adapter, development publication and trusted TSR
 * address builder.
 * @returns Idempotent onboarding, authority publication and accreditation refresh operations.
 * @remarks Real EBSI onboarding remains explicitly unavailable: without a development Support
 * Office nothing is written to EBSI. Ambiguous CreateKey outcomes require the existing
 * tag-verified ceremony recovery, never blind recreation.
 */
export function postgresOrganizationOnboarding(
  database: Pool,
  options: {
    keys?: KeyCeremonyProvider<CeremonyPurpose>;
    publication?: OrganizationPublication;
    schemaAddress: (id: string) => string;
  },
) {
  const { publication } = options;
  const onboarding = new Map<string, Promise<void>>();

  /**
   * Ensure each purpose has one active KMS key bound to the organization's DID.
   * @param connection - Session holding the organization's onboarding lock.
   * @param organization - Organization row with its DID.
   * @param purposes - Purposes to ensure.
   * @param actor - Requesting account, recorded on new key requests.
   * @returns Completion when every purpose has an active key.
   * @throws Error for unavailable KMS or unresolved key creation; database errors.
   */
  async function ensureKeys(
    connection: PoolClient,
    organization: { id: string; did: string },
    purposes: OnboardingPurpose[],
    actor?: number,
  ) {
    if (!options.keys) throw new Error('KMS unavailable for organization onboarding.');
    for (const purpose of purposes) {
      const active = await connection.query(
        'SELECT 1 FROM issuer_signing_keys WHERE organization_id=$1 AND purpose=$2 AND active',
        [organization.id, purpose],
      );
      if (active.rowCount) continue;
      let intent = (
        await connection.query(
          `SELECT p.* FROM organization_key_requests r JOIN signing_key_provisions p USING(request_id) WHERE r.organization_id=$1 AND r.purpose=$2`,
          [organization.id, purpose],
        )
      ).rows[0];
      if (!intent) {
        const request = randomUUID();
        await onboardingTransaction(database, connection, async (client) => {
          await client.query(
            'INSERT INTO signing_key_provisions(request_id,organization_id,purpose,requested_by) VALUES($1,$2,$3,$4)',
            [request, organization.id, purpose, actor ?? null],
          );
          await client.query('INSERT INTO organization_key_requests VALUES($1,$2,$3)', [
            organization.id,
            purpose,
            request,
          ]);
        });
        intent = { request_id: request, phase: 'planned' };
      }
      if (intent.phase === 'planned') {
        await connection.query(
          "UPDATE signing_key_provisions SET phase='started',started_at=clock_timestamp() WHERE request_id=$1",
          [intent.request_id],
        );
        const keyId = await options.keys.create(purpose, intent.request_id);
        await connection.query(
          'UPDATE signing_key_provisions SET kms_key_id=$2 WHERE request_id=$1',
          [intent.request_id, keyId],
        );
        intent.kms_key_id = keyId;
      }
      if (!intent.kms_key_id) throw new Error('Key creation requires tag-verified recovery.');
      const material = await options.keys.inspect(intent.kms_key_id, purpose);
      const kid = organization.did + '#' + material.thumbprint;
      await onboardingTransaction(database, connection, async (client) => {
        const activated = await client.query(
          `INSERT INTO issuer_signing_keys(organization_id,kid,kms_key_id,public_jwk,purpose,active,activated_at)
          VALUES($1,$2,$3,$4,$5,true,clock_timestamp()) ON CONFLICT(organization_id,kid) DO UPDATE
          SET active=true,activated_at=COALESCE(issuer_signing_keys.activated_at,clock_timestamp())
          WHERE issuer_signing_keys.kms_key_id=EXCLUDED.kms_key_id AND issuer_signing_keys.purpose=EXCLUDED.purpose
            AND issuer_signing_keys.public_jwk=EXCLUDED.public_jwk AND issuer_signing_keys.retired_at IS NULL`,
          [organization.id, kid, material.keyId, material.publicJwk, purpose],
        );
        if (!activated.rowCount) throw new Error('The recovered onboarding key changed.');
        await client.query(
          "UPDATE signing_key_provisions SET phase='prepared',kid=$2,kms_key_id=$3,prepared_at=clock_timestamp() WHERE request_id=$1",
          [intent.request_id, kid, material.keyId],
        );
      });
    }
  }

  /**
   * The organization's keys as its DID document must show them, retired ones included.
   * @param organizationId - Organization UUID.
   * @returns Keys with relationships and windows, the ledger key first.
   * @throws Database errors.
   */
  async function documentKeys(organizationId: string): Promise<PublishedKey[]> {
    const { rows } = await database.query(
      `SELECT purpose,public_jwk,activated_at,retired_at FROM issuer_signing_keys
       WHERE organization_id=$1 AND purpose=ANY($2::text[]) AND activated_at IS NOT NULL
       ORDER BY purpose<>'ledger_transactions',activated_at,kid`,
      [organizationId, Object.keys(relationships)],
    );
    return rows.map((row) => ({
      publicJwk: row.public_jwk,
      relationships: [...relationships[row.purpose as OnboardingPurpose]],
      activatedAt: row.activated_at,
      retiredAt: row.retired_at,
    }));
  }

  /**
   * When the organization's ledger key became valid, the DID's registration time.
   * @param organizationId - Organization UUID.
   * @returns Its activation time.
   * @throws Error when it has none.
   */
  async function ledgerKeyActivation(organizationId: string): Promise<Date> {
    const {
      rows: [key],
    } = await database.query(
      "SELECT activated_at FROM issuer_signing_keys WHERE organization_id=$1 AND purpose='ledger_transactions' AND active",
      [organizationId],
    );
    if (!key?.activated_at) throw new Error('The organization holds no active ledger key.');
    return key.activated_at;
  }

  /**
   * Record an organization's accreditation attribute after the registry stored it.
   * @param organizationId - Organization UUID.
   * @param did - Its DID.
   * @param attributeId - Attribute id.
   * @param type - Its issuer type, for the journal.
   * @returns Completion.
   * @throws Database errors.
   */
  async function recordAttribute(
    organizationId: string,
    did: string,
    attributeId: string,
    type: string,
  ) {
    await transaction(database, async (client) => {
      const { rowCount } = await client.query(
        'UPDATE accredited_organizations SET tir_attribute_id=$2 WHERE id=$1 AND tir_attribute_id IS DISTINCT FROM $2',
        [organizationId, attributeId],
      );
      if (rowCount)
        await appendAudit(client, {
          event: 'organization.ebsi_published',
          organizationId,
          detail: { did, attribute: attributeId, issuer_type: type },
        });
    });
  }

  /**
   * Store an accreditation unless the registry already holds one with the same coverage.
   * @param subject - Accredited organization as a registry writer.
   * @param attributeId - Its attribute.
   * @param scopes - Requested coverage.
   * @param issue - Issues the credential when a new one is needed.
   * @returns Completion.
   * @throws Registry, token, KMS or RPC errors.
   */
  async function storeAccreditation(
    subject: EbsiActor,
    attributeId: string,
    scopes: AccreditationScope[],
    issue: () => Promise<string>,
  ) {
    const current = await publication!.ebsi.publisher!.attribute(subject.did, attributeId);
    if (current?.body && storedCoverage(current.body) === coverageText(scopes)) return;
    await publication!.ebsi.publisher!.store(subject, attributeId, await issue());
  }

  /**
   * Publish a RootTAO or TAO: its keys, its DID and its accreditation, parents first.
   * @param organizationId - RootTAO or TAO organization UUID.
   * @returns It as a registry writer, with its attribute.
   * @throws Error outside development, for a revoked or unregistered authority; registry, KMS
   * or database errors.
   */
  async function ensureAuthority(organizationId: string): Promise<EbsiActor> {
    if (!publication?.ebsi.publisher || !publication.ebsi.supportOffice)
      throw new Error('EBSI onboarding is not automated outside development mock mode.');
    const { publisher, supportOffice } = publication.ebsi;
    const connection = await database.connect();
    try {
      await connection.query('SELECT pg_advisory_lock(651904,hashtext($1))', [organizationId]);
      const {
        rows: [organization],
      } = await connection.query('SELECT * FROM accredited_organizations WHERE id=$1', [
        organizationId,
      ]);
      if (!organization || !['rtao', 'tao'].includes(organization.kind) || organization.revoked_at)
        throw new Error('Only a live RootTAO or TAO is published as an authority.');
      if (!organization.did) {
        organization.did = newDid();
        await connection.query(
          "UPDATE accredited_organizations SET did=$2 WHERE id=$1 AND (did IS NULL OR did='')",
          [organizationId, organization.did],
        );
      }
      await ensureKeys(connection, organization, authorityPurposes);
    } finally {
      try {
        await connection.query('SELECT pg_advisory_unlock(651904,hashtext($1))', [organizationId]);
      } finally {
        connection.release();
      }
    }
    const {
      rows: [organization],
    } = await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [
      organizationId,
    ]);
    const actor = await publication.ebsi.actor(organizationId);
    // Gas for the authority's ledger key on a development ledger; EBSI charges none.
    await supportOffice.fund(await actor.ledger.signer.getAddress());
    if (organization.kind === 'tao' && !organization.ebsi_invoke_credential)
      // The TAO sets its TIs up on the governance contract, a Trusted Contract.
      await database.query(
        'UPDATE accredited_organizations SET ebsi_invoke_credential=$2 WHERE id=$1 AND ebsi_invoke_credential IS NULL',
        [organizationId, await supportOffice.invoke(actor.did)],
      );
    if (organization.kind === 'rtao') {
      // The Support Office onboards a RootTAO and accredits it.
      await publisher.ensureDid(
        actor,
        () => supportOffice.onboarding(actor.did),
        await ledgerKeyActivation(organizationId),
      );
      await publisher.publishKeys(actor, await documentKeys(organizationId));
      const stored = actor.attributeId && (await publisher.attribute(actor.did, actor.attributeId));
      if (!stored?.body || stored.issuerType !== 'RootTAO') {
        const root = await supportOffice.rootTao(actor.did);
        await publisher.store(actor, root.attributeId, root.credential);
        await recordAttribute(organizationId, actor.did, root.attributeId, 'RootTAO');
        actor.attributeId = root.attributeId;
      }
      return actor;
    }
    const root = await ensureAuthority(organization.parent_id);
    const rootSigner = await publication.ebsi.jws(organization.parent_id, 'credential_signing');
    await publisher.ensureDid(
      actor,
      () =>
        trustChainCredential({
          signer: rootSigner,
          issuer: root.did,
          subject: actor.did,
          type: 'VerifiableAuthorisationToOnboard',
          schema: publication.accreditationSchema,
        }),
      await ledgerKeyActivation(organizationId),
    );
    await publisher.publishKeys(actor, await documentKeys(organizationId));
    const attributeId = await publisher.accredit(root, actor.did, 'TAO');
    // A TAO may accredit its TIs for any published schema; each TI's own coverage narrows it.
    const scopes = await accreditationCoverage(database, options.schemaAddress);
    await storeAccreditation(actor, attributeId, scopes, () =>
      trustChainCredential({
        signer: rootSigner,
        issuer: root.did,
        subject: actor.did,
        type: 'VerifiableAccreditationToAccredit',
        attributeId,
        accreditedFor: scopes,
        termsOfUse: `${publication.tirUrl}/issuers/${root.did}/attributes/${root.attributeId}`,
        schema: publication.accreditationSchema,
      }),
    );
    await recordAttribute(organizationId, actor.did, attributeId, 'TAO');
    return { ...actor, attributeId };
  }

  /**
   * Publish a TI's accreditation for its current schema coverage.
   * @param id - TI organization UUID.
   * @param connection - Internal onboarding session, omitted by standalone refresh callers.
   * @returns Completion after the registry holds it, or no operation outside development or
   * for a TI not onboarded yet.
   * @throws Registry, KMS or database errors; callers retain the committed local change and
   * retry later.
   */
  async function refresh(id: string, connection?: PoolClient) {
    if (!publication?.ebsi.publisher) return;
    const {
      rows: [ti],
    } = await (connection ?? database).query(
      `SELECT ti.*, COALESCE(ti.revoked_at,tao.revoked_at,root.revoked_at) AS chain_revoked
       FROM accredited_organizations ti JOIN accredited_organizations tao ON tao.id=ti.parent_id
       LEFT JOIN accredited_organizations root ON root.id=tao.parent_id WHERE ti.id=$1`,
      [id],
    );
    if (!ti?.did || ti.kind !== 'ti') return;
    if (!connection && !ti.tir_attribute_id) return;
    // A queued refresh must never seed an issuer after a committed withdrawal.
    if (ti.chain_revoked) {
      if (connection) throw new Error('The TI was revoked while onboarding.');
      return;
    }
    const { publisher } = publication.ebsi;
    const tao = await ensureAuthority(ti.parent_id);
    const taoSigner = await publication.ebsi.jws(ti.parent_id, 'credential_signing');
    const actor = await publication.ebsi.actor(id);
    const attributeId = await publisher.accredit(tao, ti.did, 'TI');
    const scopes = await accreditationCoverage(database, options.schemaAddress, id);
    await storeAccreditation(actor, attributeId, scopes, () =>
      trustChainCredential({
        signer: taoSigner,
        issuer: tao.did,
        subject: ti.did,
        type: 'VerifiableAccreditationToAttest',
        attributeId,
        accreditedFor: scopes,
        termsOfUse: `${publication.tirUrl}/issuers/${tao.did}/attributes/${tao.attributeId}`,
        schema: publication.accreditationSchema,
        validUntil: ti.accredited_until ?? undefined,
      }),
    );
    await recordAttribute(id, ti.did, attributeId, 'TI');
  }

  /**
   * Run one onboarding attempt for a TI; see `onboard`.
   * @param id - Registered TI UUID.
   * @param actor - Registering account ID, or omitted for explicit synchronization.
   * @returns Completion when the TI can issue; the governance setup may remain pending.
   * @throws Error for unavailable KMS/EBSI, invalid authority or unresolved key creation;
   * database/crypto errors.
   */
  async function onboardIssuer(id: string, actor?: number) {
    const connection = await database.connect();
    let wasIssuer = false;
    let did: string;
    try {
      await connection.query('SELECT pg_advisory_lock(651904,hashtext($1))', [id]);
      const {
        rows: [organization],
      } = await connection.query(
        `
          SELECT ti.*, COALESCE(ti.revoked_at,tao.revoked_at,root.revoked_at) AS chain_revoked
          FROM accredited_organizations ti LEFT JOIN accredited_organizations tao ON tao.id=ti.parent_id
          LEFT JOIN accredited_organizations root ON root.id=tao.parent_id WHERE ti.id=$1
        `,
        [id],
      );
      if (
        !organization ||
        organization.kind !== 'ti' ||
        !organization.account_id ||
        organization.chain_revoked
      )
        throw new Error('Only a registered, nonrevoked TI can be onboarded.');
      if (!options.keys) throw new Error('KMS unavailable for issuer onboarding.');
      wasIssuer = Boolean(organization.did && organization.tir_attribute_id);
      if (!organization.did) {
        organization.did = newDid();
        await connection.query(
          "UPDATE accredited_organizations SET did=$2 WHERE id=$1 AND (did IS NULL OR did='')",
          [id, organization.did],
        );
      }
      did = organization.did;
      await ensureKeys(connection, organization, issuerPurposes, actor);
      if (!publication?.ebsi.publisher || !publication.ebsi.supportOffice)
        throw new Error('EBSI onboarding is not automated outside development mock mode.');
    } finally {
      try {
        await connection.query('SELECT pg_advisory_unlock(651904,hashtext($1))', [id]);
      } finally {
        connection.release();
      }
    }

    const { publisher, supportOffice } = publication.ebsi;
    const {
      rows: [ti],
    } = await database.query(
      'SELECT parent_id,ebsi_invoke_credential FROM accredited_organizations WHERE id=$1',
      [id],
    );
    const tao = await ensureAuthority(ti.parent_id);
    const taoSigner = await publication.ebsi.jws(ti.parent_id, 'credential_signing');
    const issuer = await publication.ebsi.actor(id);
    // Gas for the TI's keys on a development ledger; EBSI charges none.
    for (const purpose of [
      'ledger_transactions',
      'governance_role_a',
      'governance_role_b',
    ] as const)
      await supportOffice.fund(
        await (await publication.ebsi.ledgerSigner(id, purpose)).getAddress(),
      );
    await publisher.ensureDid(
      issuer,
      () =>
        trustChainCredential({
          signer: taoSigner,
          issuer: tao.did,
          subject: did,
          type: 'VerifiableAuthorisationToOnboard',
          schema: publication.accreditationSchema,
        }),
      await ledgerKeyActivation(id),
    );
    await publisher.publishKeys(issuer, await documentKeys(id));
    const lock = await database.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(651904,hashtext($1))', [id]);
      await refresh(id, lock);
    } finally {
      try {
        await lock.query('SELECT pg_advisory_unlock(651904,hashtext($1))', [id]);
      } finally {
        lock.release();
      }
    }
    if (!ti.ebsi_invoke_credential)
      await database.query(
        'UPDATE accredited_organizations SET ebsi_invoke_credential=$2 WHERE id=$1 AND ebsi_invoke_credential IS NULL',
        [id, await supportOffice.invoke(did)],
      );
    const setup = await publication.governance?.ensure(id);
    if (setup?.state === 'pending') console.error(`TI governance setup pending: ${setup.reason}`);
    if (!wasIssuer)
      await transaction(database, (client) =>
        appendAudit(client, {
          event: 'organization.issuer_confirmed',
          actor,
          organizationId: id,
          detail: { did },
        }),
      );
  }

  return {
    refresh,
    ensureAuthority,

    /**
     * Allocate purpose-separated keys and, in development, publish a registered TI: its DID and
     * keys, its accreditation, its access to the contracts and its governance setup.
     * @param id - Registered TI UUID.
     * @param actor - Registering account ID, or omitted for explicit synchronization.
     * @returns Completion when the TI can issue; the governance setup may remain pending.
     * @throws Error for unavailable KMS/EBSI, invalid authority or unresolved key creation;
     * database/crypto errors.
     * @remarks Attempts for one TI queue here, in this process, rather than on pooled sessions:
     * the attempt holding the TI's session lock needs further sessions for its registry writes.
     */
    async onboard(id: string, actor?: number) {
      const previous = onboarding.get(id);
      const attempt = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => onboardIssuer(id, actor));
      onboarding.set(id, attempt);
      try {
        await attempt;
      } finally {
        if (onboarding.get(id) === attempt) onboarding.delete(id);
      }
    },
  };
}
