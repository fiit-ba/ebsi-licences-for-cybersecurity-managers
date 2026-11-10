import { publicEcKey } from '../ebsi/did-registry.ts';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { authorizeAdministrator } from '../identity/administration/management.ts';
import type { didRegistry, PublicEcKey } from '../ebsi/did-registry.ts';
import { signingPurposes } from '../../shared/signing-keys.ts';
import type { SigningPurpose, SigningKeyView } from '../../shared/signing-keys.ts';
import type { KeyCeremonyProvider, KmsKeyMaterial } from './kms-provider.ts';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const didPattern = /^did:ebsi:z[1-9A-HJ-NP-Za-km-z]{1,100}$/;

/** Key lifecycle refusal with an explicit reason suitable for CLI and future HTTP adapters. */
export class KeyManagementError extends Error {
  readonly reason: string;

  /**
   * Create a key lifecycle refusal without private/provider response data.
   * @param reason - Stable refusal code.
   * @param detail - Public operator explanation.
   */
  constructor(reason: string, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

/** Locked organization identity used to serialize ceremonies with hierarchy changes. */
interface OrganizationRow {
  id: string;
  parent_id: string | null;
  did: string;
  kind: string;
  account_id: number | null;
  revoked_at: Date | null;
  depth: number;
}

/** Stored key material and lifecycle metadata, kept inside the server. */
interface KeyRow {
  organization_id: string;
  kid: string;
  kms_key_id: string;
  purpose: SigningPurpose;
  public_jwk: PublicEcKey;
  active: boolean;
  created_at: Date | null;
  activated_at: Date | null;
  retired_at: Date | null;
}

/**
 * Require a supported purpose rather than indexing the purpose map with untrusted data.
 * @param value - Requested purpose.
 * @returns The recognized signing purpose.
 * @throws KeyManagementError for an unknown purpose.
 */
function purposeValue(value: string): SigningPurpose {
  if (!Object.hasOwn(signingPurposes, value))
    throw new KeyManagementError('InvalidPurpose', 'Unknown signing purpose.');
  return value as SigningPurpose;
}

/**
 * Lock a registered, nonrevoked hierarchy from root to leaf before checking admin authority.
 * @param client - Transaction connection.
 * @param actor - Current administrator account ID.
 * @param organizationId - Target organization UUID.
 * @param requireDid - Whether an immutable DID binding must already exist.
 * @returns The locked organization.
 * @throws KeyManagementError for missing, revoked, unregistered or changed hierarchy; authorization/database errors.
 */
async function organization(
  client: PoolClient,
  actor: number,
  organizationId: string,
  requireDid = true,
): Promise<OrganizationRow> {
  organizationId = organizationId.toLowerCase();
  if (!uuid.test(organizationId))
    throw new KeyManagementError('UnknownOrganization', 'Unknown organization.');
  const path = (
    await client.query<OrganizationRow>(
      `
    WITH RECURSIVE path AS (
      SELECT id,parent_id,did,kind,account_id,revoked_at,0 AS depth FROM accredited_organizations WHERE id=$1
      UNION ALL SELECT p.id,p.parent_id,p.did,p.kind,p.account_id,p.revoked_at,path.depth+1
      FROM accredited_organizations p JOIN path ON p.id=path.parent_id
    ) SELECT * FROM path ORDER BY depth DESC
  `,
      [organizationId],
    )
  ).rows;
  if (!path.length) throw new KeyManagementError('UnknownOrganization', 'Unknown organization.');
  let target: OrganizationRow;
  for (const expected of path) {
    const row = (
      await client.query<OrganizationRow>(
        `
      SELECT id,parent_id,did,kind,account_id,revoked_at FROM accredited_organizations WHERE id=$1
      FOR ${expected.id === organizationId ? 'UPDATE' : 'SHARE'}
    `,
        [expected.id],
      )
    ).rows[0];
    if (
      !row ||
      row.parent_id !== expected.parent_id ||
      (row.revoked_at && +row.revoked_at <= Date.now())
    )
      throw new KeyManagementError(
        'OrganizationUnavailable',
        'The hierarchy changed or was revoked.',
      );
    if (row.id === organizationId) target = row;
  }
  await authorizeAdministrator(client, actor, true);
  if (!target!.account_id || (requireDid && !didPattern.test(target!.did)))
    throw new KeyManagementError(
      'IdentityRequired',
      'Register the organization and bind its EBSI DID before preparing keys.',
    );
  return target!;
}

/**
 * Expose public history without the internal KMS locator.
 * @param row - Stored key row.
 * @returns The public key, purpose and known lifecycle dates.
 * @throws DidResolutionError if stored public material is malformed.
 */
function keyView(row: KeyRow): SigningKeyView {
  const publicJwk = publicEcKey(row.public_jwk);
  return {
    key_id: row.kid,
    organization_id: row.organization_id,
    purpose: row.purpose,
    curve: publicJwk.crv,
    state: row.active ? 'active' : row.retired_at ? 'retired' : 'pending',
    public_jwk: publicJwk,
    created_at: row.created_at,
    activated_at: row.activated_at,
    retired_at: row.retired_at,
  };
}

/**
 * Compare only canonical public EC key coordinates and curve.
 * @param left - First validated public key.
 * @param right - Second validated public key.
 * @returns Whether both keys identify the same material.
 */
function sameKey(left: PublicEcKey, right: PublicEcKey): boolean {
  return (
    left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y
  );
}

/**
 * Store an inspected key as pending, preserving idempotency and material separation.
 * @param client - Authorized organization transaction.
 * @param owner - Locked immutable organization identity.
 * @param purpose - Independent key purpose.
 * @param material - Canonical inspected KMS key.
 * @returns The public key plus whether it was inserted, so the caller journals after all writes.
 * @throws KeyManagementError for material/purpose reuse or a conflicting key identifier; database errors.
 */
async function prepare(
  client: PoolClient,
  owner: OrganizationRow,
  purpose: SigningPurpose,
  material: KmsKeyMaterial,
): Promise<{ key: SigningKeyView; inserted: boolean }> {
  if (purpose === 'timestamp_transactions' && owner.kind !== 'rtao')
    throw new KeyManagementError('TimestampOwner', 'The registry RootTAO owns timestamp keys.');
  await client.query('SELECT pg_advisory_xact_lock(780264156)');
  const kid = owner.did + '#' + material.thumbprint;
  const existing = (
    await client.query<KeyRow>(
      'SELECT * FROM issuer_signing_keys WHERE organization_id=$1 AND kid=$2',
      [owner.id, kid],
    )
  ).rows[0];
  if (existing) {
    if (
      existing.purpose !== purpose ||
      existing.kms_key_id !== material.keyId ||
      !sameKey(existing.public_jwk, material.publicJwk)
    )
      throw new KeyManagementError(
        'KeyAlreadyAssigned',
        'This key belongs to a different purpose or KMS identity.',
      );
    return { key: keyView(existing), inserted: false };
  }
  const inserted = (
    await client.query<KeyRow>(
      `
    INSERT INTO issuer_signing_keys (organization_id,kid,kms_key_id,public_jwk,purpose)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *
  `,
      [owner.id, kid, material.keyId, JSON.stringify(material.publicJwk), purpose],
    )
  ).rows[0];
  if (!inserted)
    throw new KeyManagementError(
      'KeyAlreadyAssigned',
      'Key material cannot be shared between organizations or purposes.',
    );
  return { key: keyView(inserted), inserted: true };
}

/**
 * Create durable key ceremonies and two-phase activation against published DID relationships.
 * @param database - PostgreSQL pool.
 * @param options - Ceremony-only KMS provider, configured DID reader and optional accreditation checker.
 * @returns Identity binding, planning/provision/recovery, attachment, activation, retirement and public history operations.
 * @remarks No operation deletes keys or private material. A started uncertain CreateKey call is never repeated.
 */
export function postgresKeyManagement(
  database: Pool,
  options: {
    kms: KeyCeremonyProvider;
    dids: ReturnType<typeof didRegistry>;
    ensureAccredited?: (
      did: string,
      type: string,
      context: { attribute: string; schemaId: string },
    ) => Promise<void>;
    schemaAddress?: (id: string) => string;
  },
) {
  const { kms, dids } = options;
  return {
    /**
     * Bind a local organization to its immutable EBSI DID without claiming external onboarding.
     * @param actor - Administrator account ID.
     * @param organizationId - Registered organization UUID.
     * @param did - Legal-entity EBSI DID.
     * @returns The bound DID and organization ID.
     * @throws KeyManagementError for rebinding, duplicate identity or invalid input; authorization/database/audit errors.
     */
    async identity(actor: number, organizationId: string, did: string) {
      if (!didPattern.test(did))
        throw new KeyManagementError('InvalidDid', 'Supply an EBSI legal-entity DID.');
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId, false);
        await client.query('SELECT pg_advisory_xact_lock(901481014)');
        if (owner.did && owner.did !== did)
          throw new KeyManagementError(
            'IdentityImmutable',
            'The organization DID cannot be replaced.',
          );
        const duplicate = (
          await client.query('SELECT 1 FROM accredited_organizations WHERE did=$1 AND id<>$2', [
            did,
            owner.id,
          ])
        ).rowCount;
        if (duplicate)
          throw new KeyManagementError(
            'IdentityAlreadyAssigned',
            'This DID is already bound to another organization.',
          );
        if (!owner.did) {
          await client.query('UPDATE accredited_organizations SET did=$2 WHERE id=$1', [
            owner.id,
            did,
          ]);
          await appendAudit(client, {
            event: 'organization.identity_bound',
            actor,
            organizationId: owner.id,
            detail: { did },
          });
        }
        return { organization_id: owner.id, did };
      });
    },
    /**
     * List pending, active and retired public keys for an organization.
     * @param actor - Administrator account ID.
     * @param organizationId - Registered organization UUID.
     * @returns All retained public key metadata, including unknown preexisting dates as null.
     * @throws Authorization, organization or database errors.
     */
    async list(actor: number, organizationId: string): Promise<SigningKeyView[]> {
      return transaction(database, async (client: PoolClient) => {
        await organization(client, actor, organizationId, false);
        return (
          await client.query<KeyRow>(
            'SELECT * FROM issuer_signing_keys WHERE organization_id=$1 ORDER BY purpose,created_at NULLS FIRST,kid',
            [organizationId],
          )
        ).rows.map(keyView);
      });
    },
    /**
     * Commit a creation request before any external KMS write.
     * @param actor - Administrator account ID.
     * @param organizationId - Registered organization UUID with a bound DID.
     * @param purpose - Requested key purpose.
     * @param requestId - Caller-retained UUID used for every retry of this intent.
     * @returns The existing or newly planned request phase and public identifier.
     * @throws KeyManagementError for conflicting reuse, invalid purpose or ownership; authorization/database/audit errors.
     */
    async plan(actor: number, organizationId: string, purpose: string, requestId: string) {
      const selected = purposeValue(purpose);
      requestId = requestId.toLowerCase();
      if (!uuid.test(requestId))
        throw new KeyManagementError('InvalidRequest', 'Retain a provisioning request UUID.');
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId);
        if (selected === 'timestamp_transactions' && owner.kind !== 'rtao')
          throw new KeyManagementError('TimestampOwner', 'The registry owns timestamp keys.');
        const inserted = (
          await client.query(
            `
          INSERT INTO signing_key_provisions (request_id,organization_id,purpose,requested_by) VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING RETURNING phase
        `,
            [requestId, owner.id, selected, actor],
          )
        ).rows[0];
        const row =
          inserted ??
          (
            await client.query('SELECT * FROM signing_key_provisions WHERE request_id=$1', [
              requestId,
            ])
          ).rows[0];
        if (!inserted && (row.organization_id !== owner.id || row.purpose !== selected))
          throw new KeyManagementError(
            'RequestConflict',
            'A provisioning request cannot change organization or purpose.',
          );
        if (inserted)
          await appendAudit(client, {
            event: 'key.creation_planned',
            actor,
            organizationId: owner.id,
            detail: { purpose: selected, request_id: requestId },
          });
        return { request_id: requestId, phase: row.phase };
      });
    },
    /**
     * Create or resume a durable key request; recover a lost response only with matching KMS tags.
     * @param actor - Administrator account ID.
     * @param requestId - Previously committed provisioning UUID.
     * @param recoverKey - Optional known KMS locator from the original uncertain creation.
     * @returns The prepared public key.
     * @throws KeyManagementError when creation is uncertain, conflicting or unauthorized; KMS/database/audit errors.
     * @remarks The single-attempt CreateKey call follows a committed started marker. Provider errors leave it started.
     */
    async provision(
      actor: number,
      requestId: string,
      recoverKey?: string,
    ): Promise<SigningKeyView> {
      requestId = requestId.toLowerCase();
      if (!uuid.test(requestId))
        throw new KeyManagementError('InvalidRequest', 'Unknown provisioning request.');
      const intent = await transaction(database, async (client: PoolClient) => {
        const target = (
          await client.query(
            'SELECT organization_id FROM signing_key_provisions WHERE request_id=$1',
            [requestId],
          )
        ).rows[0];
        if (!target)
          throw new KeyManagementError('UnknownRequest', 'Unknown provisioning request.');
        await organization(client, actor, target.organization_id);
        const row = (
          await client.query(
            'SELECT * FROM signing_key_provisions WHERE request_id=$1 FOR UPDATE',
            [requestId],
          )
        ).rows[0];
        if (row.phase !== 'planned') return { ...row, create: false };
        if (recoverKey)
          throw new KeyManagementError(
            'RecoveryNotStarted',
            'An unstarted intent has no creation to recover.',
          );
        await client.query(
          "UPDATE signing_key_provisions SET phase='started',started_at=clock_timestamp() WHERE request_id=$1",
          [requestId],
        );
        await appendAudit(client, {
          event: 'key.creation_started',
          actor,
          organizationId: row.organization_id,
          detail: { request_id: requestId, purpose: row.purpose },
        });
        return { ...row, phase: 'started', create: true };
      });
      let keyId = intent.kms_key_id as string | null;
      if (intent.create) keyId = await kms.create(intent.purpose, requestId);
      if (recoverKey) {
        await kms.createdFor(recoverKey, intent.purpose, requestId);
        const recovery = await kms.inspect(recoverKey, intent.purpose);
        if (keyId && (await kms.inspect(keyId, intent.purpose)).keyId !== recovery.keyId)
          throw new KeyManagementError(
            'RecoveryConflict',
            'A different KMS key is already recorded for this intent.',
          );
        keyId = recovery.keyId;
      }
      if (!keyId)
        throw new KeyManagementError(
          'KeyCreationUncertain',
          'Creation started without a recorded result. Recover its tagged KMS key; do not create another key.',
        );
      // Record the external fact before inspection/authorization can fail.
      await database.query(
        'UPDATE signing_key_provisions SET kms_key_id=COALESCE(kms_key_id,$2) WHERE request_id=$1',
        [requestId, keyId],
      );
      const material = await kms.inspect(keyId, intent.purpose);
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, intent.organization_id);
        const row = (
          await client.query(
            'SELECT * FROM signing_key_provisions WHERE request_id=$1 FOR UPDATE',
            [requestId],
          )
        ).rows[0];
        if (
          row.kms_key_id &&
          (await kms.inspect(row.kms_key_id, intent.purpose)).keyId !== material.keyId
        )
          throw new KeyManagementError('RecoveryConflict', 'The recorded KMS result changed.');
        const prepared = await prepare(client, owner, intent.purpose, material);
        const key = prepared.key;
        if (row.phase !== 'prepared') {
          await client.query(
            "UPDATE signing_key_provisions SET phase='prepared',kms_key_id=$2,kid=$3,prepared_at=clock_timestamp() WHERE request_id=$1",
            [requestId, material.keyId, key.key_id],
          );
          if (prepared.inserted)
            await appendAudit(client, {
              event: 'key.prepared',
              actor,
              organizationId: owner.id,
              detail: { kid: key.key_id, purpose: key.purpose },
            });
          await appendAudit(client, {
            event: 'key.creation_completed',
            actor,
            organizationId: owner.id,
            detail: { request_id: requestId, purpose: intent.purpose, kid: key.key_id },
          });
        }
        return key;
      });
    },
    /**
     * Attach a separately created ceremony key as pending without trusting caller JWK data.
     * @param actor - Administrator account ID.
     * @param organizationId - Registered organization UUID.
     * @param purpose - Key purpose.
     * @param keyId - Existing KMS ID, ARN or initial alias.
     * @returns Its canonical pending/public history record.
     * @throws KeyManagementError for conflicting ownership/purpose; KMS, authorization, database or audit errors.
     */
    async attach(
      actor: number,
      organizationId: string,
      purpose: string,
      keyId: string,
    ): Promise<SigningKeyView> {
      const selected = purposeValue(purpose);
      await transaction(database, async (client: PoolClient) => {
        await organization(client, actor, organizationId);
      });
      const material = await kms.inspect(keyId, selected);
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId);
        const prepared = await prepare(client, owner, selected, material);
        if (prepared.inserted)
          await appendAudit(client, {
            event: 'key.prepared',
            actor,
            organizationId: owner.id,
            detail: { kid: prepared.key.key_id, purpose: selected },
          });
        return prepared.key;
      });
    },
    /**
     * Activate only an exact currently published key, atomically retiring its predecessor.
     * @param actor - Administrator account ID.
     * @param organizationId - Organization UUID.
     * @param kid - Prepared verification-method ID.
     * @param expectedActive - Observed active key ID, or null for initial activation.
     * @returns The active key record.
     * @throws KeyManagementError for retired keys, changed active generation or publication mismatch;
     * registry, KMS, authorization, database or audit errors.
     */
    async activate(
      actor: number,
      organizationId: string,
      kid: string,
      expectedActive: string | null,
    ): Promise<SigningKeyView> {
      if (expectedActive !== null && typeof expectedActive !== 'string')
        throw new KeyManagementError(
          'ExpectedActiveRequired',
          'Supply the observed active key or null.',
        );
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId);
        const target = (
          await client.query<KeyRow>(
            'SELECT * FROM issuer_signing_keys WHERE organization_id=$1 AND kid=$2 FOR UPDATE',
            [owner.id, kid],
          )
        ).rows[0];
        if (!target) throw new KeyManagementError('UnknownKey', 'Unknown prepared key.');
        if (target.retired_at)
          throw new KeyManagementError('KeyRetired', 'A retired key cannot be reactivated.');
        const active = (
          await client.query<KeyRow>(
            'SELECT * FROM issuer_signing_keys WHERE organization_id=$1 AND purpose=$2 AND active FOR UPDATE',
            [owner.id, target.purpose],
          )
        ).rows[0];
        if (!target.active && (active?.kid ?? null) !== expectedActive)
          throw new KeyManagementError(
            'ActiveKeyChanged',
            'The active key changed; inspect it before rotating.',
          );
        const material = await kms.inspect(target.kms_key_id, target.purpose);
        const relationship = signingPurposes[target.purpose].relationship;
        const published = await dids.key(
          owner.did,
          target.kid,
          relationship,
          undefined,
          material.publicJwk.crv,
        );
        if (
          target.kid !== owner.did + '#' + material.thumbprint ||
          !sameKey(material.publicJwk, target.public_jwk) ||
          !sameKey(published, target.public_jwk)
        )
          throw new KeyManagementError(
            'KeyPublicationMismatch',
            'The KMS key and published verification method do not match the prepared key.',
          );
        if (target.active) return keyView(target);
        const instant = (await client.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
          .at;
        if (active)
          await client.query(
            'UPDATE issuer_signing_keys SET active=false,retired_at=$3 WHERE organization_id=$1 AND kid=$2',
            [owner.id, active.kid, instant],
          );
        const updated = (
          await client.query<KeyRow>(
            'UPDATE issuer_signing_keys SET active=true,activated_at=$3 WHERE organization_id=$1 AND kid=$2 RETURNING *',
            [owner.id, target.kid, instant],
          )
        ).rows[0];
        await appendAudit(client, {
          event: 'key.activated',
          actor,
          organizationId: owner.id,
          detail: { kid, purpose: target.purpose, previous_kid: active?.kid ?? null },
        });
        return keyView(updated);
      });
    },
    /**
     * Confirm a TI's existing external accreditation for every currently granted published schema.
     * @param actor - Administrator account ID.
     * @param organizationId - Registered TI UUID.
     * @param attribute - Existing TIR attribute identifier.
     * @returns Verified DID, attribute and credential-type names.
     * @throws KeyManagementError for missing keys, grants or adapters; registry, authorization, database/audit errors.
     * @remarks This read-confirmation step performs no DIDR/TIR write. Issuance revalidates trust later.
     */
    async confirmIssuer(actor: number, organizationId: string, attribute: string) {
      if (
        !/^[A-Za-z0-9_-]{1,200}$/.test(attribute) ||
        !options.ensureAccredited ||
        !options.schemaAddress
      )
        throw new KeyManagementError(
          'AccreditationConfiguration',
          'Configure trust adapters and supply an existing TIR attribute.',
        );
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId);
        if (owner.kind !== 'ti')
          throw new KeyManagementError(
            'NotATI',
            'Only a TI is confirmed for certificate issuance.',
          );
        const key = (
          await client.query<KeyRow>(
            "SELECT * FROM issuer_signing_keys WHERE organization_id=$1 AND purpose='credential_signing' AND active FOR SHARE",
            [owner.id],
          )
        ).rows[0];
        if (
          !key ||
          !sameKey(
            await dids.key(owner.did, key.kid, 'assertionMethod', undefined, 'P-256'),
            key.public_jwk,
          )
        )
          throw new KeyManagementError(
            'ActiveKeyRequired',
            'Publish and activate the TI credential key first.',
          );
        const schemas = (
          await client.query<{ credential_type: string; tsr_id: string }>(
            `
          SELECT s.credential_type,published.tsr_id FROM certificate_schemas s
          JOIN organization_certificate_schemas own_grant ON own_grant.schema_id=s.id AND own_grant.organization_id=$1
          JOIN organization_certificate_schemas parent_grant ON parent_grant.schema_id=s.id AND parent_grant.organization_id=$2
          JOIN LATERAL (SELECT tsr_id FROM certificate_schema_versions WHERE schema_id=s.id AND registered_at IS NOT NULL ORDER BY version DESC LIMIT 1) published ON true
          WHERE s.retired_at IS NULL ORDER BY s.credential_type FOR SHARE OF s
        `,
            [owner.id, owner.parent_id],
          )
        ).rows;
        if (!schemas.length)
          throw new KeyManagementError(
            'PublishedGrantRequired',
            'Grant at least one published schema before confirming issuer accreditation.',
          );
        for (const schema of schemas)
          await options.ensureAccredited!(owner.did, schema.credential_type, {
            attribute,
            schemaId: options.schemaAddress!(schema.tsr_id),
          });
        await client.query('UPDATE accredited_organizations SET tir_attribute_id=$2 WHERE id=$1', [
          owner.id,
          attribute,
        ]);
        const types = schemas.map((schema) => schema.credential_type);
        await appendAudit(client, {
          event: 'organization.issuer_confirmed',
          actor,
          organizationId: owner.id,
          detail: { did: owner.did, attribute, credential_types: types },
        });
        return {
          organization_id: owner.id,
          did: owner.did,
          tir_attribute_id: attribute,
          verified_schemas: types,
        };
      });
    },
    /**
     * Stop local use of a key while preserving its public material and validity window.
     * @param actor - Administrator account ID.
     * @param organizationId - Organization UUID.
     * @param kid - Verification-method ID to retire.
     * @returns Its retained retired history record.
     * @throws KeyManagementError for an unknown key; authorization/database/audit errors.
     * @remarks Does not disable/delete KMS keys or revoke DID Registry methods; those external actions require separate explicit intents.
     */
    async retire(actor: number, organizationId: string, kid: string): Promise<SigningKeyView> {
      return transaction(database, async (client: PoolClient) => {
        const owner = await organization(client, actor, organizationId);
        const row = (
          await client.query<KeyRow>(
            'SELECT * FROM issuer_signing_keys WHERE organization_id=$1 AND kid=$2 FOR UPDATE',
            [owner.id, kid],
          )
        ).rows[0];
        if (!row) throw new KeyManagementError('UnknownKey', 'Unknown key.');
        if (row.retired_at) return keyView(row);
        const updated = (
          await client.query<KeyRow>(
            'UPDATE issuer_signing_keys SET active=false,retired_at=clock_timestamp() WHERE organization_id=$1 AND kid=$2 RETURNING *',
            [owner.id, kid],
          )
        ).rows[0];
        await appendAudit(client, {
          event: 'key.retired',
          actor,
          organizationId: owner.id,
          detail: { kid, purpose: row.purpose },
        });
        return keyView(updated);
      });
    },
  };
}
