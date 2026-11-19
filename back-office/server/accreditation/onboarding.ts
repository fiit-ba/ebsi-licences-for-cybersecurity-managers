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
import type { TaoContractDeployment } from '../lifecycle/tao-contracts.ts';

/** Purpose-separated keys, the DID relationships each holds, and who holds them. */
export const relationships = {
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
  /**
   * The schemas the trust chain's credentials name: EBSI's Verifiable Accreditation Record and
   * IssuanceCertificate type extension for an accreditation, EBSI's Verifiable Authorisation for
   * an onboarding authorisation.
   */
  trustChainSchemas: { accreditation: string[]; onboarding: string[] };
  /** Per-TI setup on the governance contract, when one is configured. */
  governance?: TiGovernanceSetup;
  /** Each TAO's own pair, deployed through EBSI's Proxy Factory once the TAO is confirmed. */
  contracts?: TaoContractDeployment;
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
   * Publish the RootTAO: its keys, its DID, and the authorisation the Support Office gives it.
   * The RootTAO is the installation's own organization; a TAO or TI publishes itself.
   * @param organizationId - RootTAO organization UUID.
   * @returns It as a registry writer, with its attribute.
   * @throws Error outside development or for a revoked RootTAO; registry, KMS or database errors.
   */
  async function ensureRootTao(organizationId: string): Promise<EbsiActor> {
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
      if (!organization || organization.kind !== 'rtao' || organization.revoked_at)
        throw new Error('Only the live RootTAO is published by the back-office.');
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
    const actor = await publication.ebsi.actor(organizationId);
    // Gas for the RootTAO's ledger key on a development ledger.
    await supportOffice.fund(await actor.ledger.signer.getAddress());
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

  /**
   * An accreditor as a registry writer: the RootTAO, published as needed, or a TAO whose
   * accreditation the Trusted Issuers Registry holds and that lists the back-office's keys.
   * @param organizationId - RootTAO or TAO organization UUID.
   * @returns It as a registry writer, with its attribute.
   * @throws Error for a TAO not in the registry yet or revoked; registry, KMS or database errors.
   */
  async function ensureAuthority(organizationId: string): Promise<EbsiActor> {
    if (!publication?.ebsi.publisher)
      throw new Error('EBSI onboarding is not automated outside development mock mode.');
    const {
      rows: [organization],
    } = await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [
      organizationId,
    ]);
    if (organization?.kind === 'rtao') return ensureRootTao(organizationId);
    if (
      organization?.kind !== 'tao' ||
      organization.revoked_at ||
      !organization.did ||
      !/^0x[0-9a-f]{64}$/.test(organization.tir_attribute_id ?? '')
    )
      throw new Error(
        'The TAO has not stored its accreditation in the Trusted Issuers Registry yet.',
      );
    return publication.ebsi.actor(organizationId);
  }

  /**
   * What an issued accreditation says: its coverage, its end and the attribute it is for.
   * @param credential - The accreditation JWT.
   * @returns Its terms, or undefined for an unreadable credential.
   */
  function issuedTerms(credential: string | null) {
    if (!credential) return undefined;
    try {
      const payload = JSON.parse(
        Buffer.from(credential.split('.')[1], 'base64url').toString('utf8'),
      );
      return {
        coverage: storedCoverage(credential),
        exp: payload.exp as number,
        attribute: payload.vc?.credentialSubject?.reservedAttributeId as string | undefined,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Issue an organization's accreditation for what it may do now, as its accreditor: reserve its
   * attribute in the Trusted Issuers Registry and sign the credential (a TAO's
   * VerifiableAccreditationToAccredit, a TI's VerifiableAccreditationToAttest). The back-office
   * keeps it for the organization to download and store in the registry with its own wallet; it
   * never stores it there for the organization.
   * @param id - TAO or TI organization UUID.
   * @returns Whether a new credential was issued; none is when the last one still says the same,
   * outside development, or for an organization not registered yet or revoked.
   * @throws Error while its accreditor is not in the registry itself; registry, KMS or database
   * errors.
   */
  async function issueAccreditation(id: string) {
    if (!publication?.ebsi.publisher) return false;
    const {
      rows: [organization],
    } = await database.query(
      `SELECT o.*, COALESCE(o.revoked_at,parent.revoked_at,root.revoked_at) AS chain_revoked
       FROM accredited_organizations o JOIN accredited_organizations parent ON parent.id=o.parent_id
       LEFT JOIN accredited_organizations root ON root.id=parent.parent_id WHERE o.id=$1`,
      [id],
    );
    if (
      !organization ||
      !['tao', 'ti'].includes(organization.kind) ||
      !organization.did ||
      !organization.account_id ||
      organization.chain_revoked
    )
      return false;
    const type = organization.kind === 'tao' ? 'TAO' : 'TI';
    const accreditor = await ensureAuthority(organization.parent_id);
    const attributeId = await publication.ebsi.publisher.accredit(
      accreditor,
      organization.did,
      type,
    );
    // A TAO may accredit its TIs for any schema in use; each TI's own coverage narrows it.
    const scopes =
      type === 'TAO'
        ? await accreditationCoverage(database, options.schemaAddress)
        : await accreditationCoverage(database, options.schemaAddress, id);
    const validUntil: Date | undefined = organization.accredited_until ?? undefined;
    const last = issuedTerms(organization.accreditation_credential);
    if (
      last &&
      last.coverage === coverageText(scopes) &&
      last.attribute === attributeId &&
      (!validUntil || last.exp === Math.floor(+validUntil / 1000))
    )
      return false;
    const credential = await trustChainCredential({
      signer: await publication.ebsi.jws(organization.parent_id, 'credential_signing'),
      issuer: accreditor.did,
      subject: organization.did,
      type:
        type === 'TAO' ? 'VerifiableAccreditationToAccredit' : 'VerifiableAccreditationToAttest',
      attributeId,
      accreditedFor: scopes,
      termsOfUse: `${publication.tirUrl}/issuers/${accreditor.did}/attributes/${accreditor.attributeId}`,
      schemas: publication.trustChainSchemas.accreditation,
      validUntil,
    });
    await transaction(database, async (client) => {
      await client.query(
        'UPDATE accredited_organizations SET accreditation_credential=$2, accreditation_issued_at=now() WHERE id=$1',
        [id, credential],
      );
      await appendAudit(client, {
        event: 'organization.accreditation_issued',
        organizationId: id,
        detail: { did: organization.did, attribute: attributeId, issuer_type: type },
      });
    });
    return true;
  }

  /**
   * The back-office's keys an organization must list in its own DID document, and whether the
   * DID Registry lists them in every relationship they need.
   * @param id - Organization UUID.
   * @param did - Its DID.
   * @returns Active keys with their kid, relationships and whether they are listed.
   * @throws Registry or database errors.
   */
  async function keysToList(id: string, did: string) {
    const document = (await publication!.ebsi.publisher!.document(did)) ?? {};
    const { rows } = await database.query(
      `SELECT purpose,kid,public_jwk FROM issuer_signing_keys
       WHERE organization_id=$1 AND active AND purpose=ANY($2::text[]) ORDER BY purpose`,
      [id, Object.keys(relationships)],
    );
    return rows.map((row) => {
      const kid = `${did}#${row.kid.split('#').at(-1)}`;
      const needed = [...relationships[row.purpose as OnboardingPurpose]];
      return {
        purpose: row.purpose as string,
        kid,
        public_jwk: row.public_jwk,
        relationships: needed,
        listed: needed.every(
          (relationship) =>
            Array.isArray(document[relationship]) &&
            document[relationship].some(
              (entry: unknown) => entry === kid || (entry as { id?: string } | null)?.id === kid,
            ),
        ),
      };
    });
  }

  /**
   * Check what an organization did in EBSI's registries: whether its DID document lists the
   * back-office's keys, and whether it stored the accreditation it was given. Once it has, it is
   * recorded as accredited in EBSI: a TAO may then accredit TIs, and a TI gets access to the
   * Trusted Contracts and is set up on the governance contract.
   * @param id - TAO or TI organization UUID.
   * @param actor - Account asking, for the journal.
   * @returns The organization's DID, its credential, the keys to list and whether it is accredited.
   * @throws Error outside development; registry, KMS or database errors.
   */
  async function check(id: string, actor?: number) {
    if (!publication?.ebsi.publisher)
      throw new Error('EBSI onboarding is not automated outside development mock mode.');
    const { publisher, supportOffice } = publication.ebsi;
    const {
      rows: [organization],
    } = await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [id]);
    if (!organization || !['tao', 'ti'].includes(organization.kind) || !organization.did)
      throw new Error('Only an appointed TAO or TI is checked in EBSI.');
    const keys = await keysToList(id, organization.did);
    const terms = issuedTerms(organization.accreditation_credential);
    let accredited = /^0x[0-9a-f]{64}$/.test(organization.tir_attribute_id ?? '');
    if (terms?.attribute && !organization.revoked_at) {
      const stored = await publisher.attribute(organization.did, terms.attribute);
      const body = typeof stored?.body === 'string' ? stored.body : '';
      // The registry holds the credential the accreditor issued last.
      const current =
        stored?.issuerType !== 'Revoked' &&
        (body === organization.accreditation_credential ||
          (/^0x[0-9a-f]*$/i.test(body) &&
            Buffer.from(body.slice(2), 'hex').toString('utf8') ===
              organization.accreditation_credential));
      if (current && keys.every((key) => key.listed)) {
        const wasIssuer = organization.kind === 'ti' && accredited;
        await recordAttribute(
          id,
          organization.did,
          terms.attribute,
          organization.kind.toUpperCase(),
        );
        accredited = true;
        if (supportOffice) {
          // Gas for its keys on a development ledger, and access to the Trusted Contracts.
          for (const key of keys.filter((key) =>
            key.relationships.includes('capabilityInvocation'),
          ))
            await supportOffice.fund(
              await (
                await publication.ebsi.ledgerSigner(
                  id,
                  key.purpose as 'ledger_transactions' | 'governance_role_a' | 'governance_role_b',
                )
              ).getAddress(),
            );
          if (!organization.ebsi_invoke_credential)
            await database.query(
              'UPDATE accredited_organizations SET ebsi_invoke_credential=$2 WHERE id=$1 AND ebsi_invoke_credential IS NULL',
              [id, await supportOffice.invoke(organization.did)],
            );
        }
        if (organization.kind === 'tao' && publication.contracts) {
          // The TAO's own certificate registry and governance contract, for its TIs.
          try {
            await publication.contracts.ensure(id);
          } catch (error) {
            console.error(`TAO contracts pending: ${(error as Error).message}`);
          }
        }
        if (organization.kind === 'ti') {
          const setup = await publication.governance?.ensure(id);
          if (setup?.state === 'pending')
            console.error(`TI governance setup pending: ${setup.reason}`);
          if (!wasIssuer)
            await transaction(database, (client) =>
              appendAudit(client, {
                event: 'organization.issuer_confirmed',
                actor,
                organizationId: id,
                detail: { did: organization.did },
              }),
            );
        }
      }
    }
    return {
      did: organization.did as string,
      accreditation: organization.accreditation_credential as string | null,
      attribute_id: terms?.attribute ?? null,
      keys: keys.map(({ public_jwk: publicJwk, ...key }) => ({ ...key, public_jwk: publicJwk })),
      accredited,
    };
  }

  /**
   * Run one onboarding attempt; see `onboard`.
   * @param id - Registered TAO or TI UUID.
   * @param actor - Registering account ID, or omitted for explicit synchronization.
   * @returns Completion once its keys exist and its accreditation is issued.
   * @throws Error for unavailable KMS, an accreditor not in the registry yet or unresolved key
   * creation; database/crypto errors.
   */
  async function onboardOrganization(id: string, actor?: number) {
    const connection = await database.connect();
    try {
      await connection.query('SELECT pg_advisory_lock(651904,hashtext($1))', [id]);
      const {
        rows: [organization],
      } = await connection.query(
        `SELECT o.*, COALESCE(o.revoked_at,parent.revoked_at,root.revoked_at) AS chain_revoked
         FROM accredited_organizations o LEFT JOIN accredited_organizations parent ON parent.id=o.parent_id
         LEFT JOIN accredited_organizations root ON root.id=parent.parent_id WHERE o.id=$1`,
        [id],
      );
      if (
        !organization ||
        !['tao', 'ti'].includes(organization.kind) ||
        !organization.account_id ||
        !organization.did ||
        organization.chain_revoked
      )
        throw new Error('Only a registered, nonrevoked TAO or TI with its DID can be onboarded.');
      await ensureKeys(
        connection,
        organization,
        organization.kind === 'tao' ? authorityPurposes : issuerPurposes,
        actor,
      );
    } finally {
      try {
        await connection.query('SELECT pg_advisory_unlock(651904,hashtext($1))', [id]);
      } finally {
        connection.release();
      }
    }
    await issueAccreditation(id);
  }

  return {
    ensureAuthority,
    check,

    /**
     * Issue an organization's accreditation again after what it may do changed (its schemas, its
     * end, a new schema version); the organization stores the new one itself.
     * @param id - TAO or TI organization UUID.
     * @returns Completion; nothing happens outside development or before it is onboarded.
     * @throws Error while its accreditor is not in the registry; registry, KMS or database errors.
     */
    async refresh(id: string) {
      await issueAccreditation(id);
    },

    /**
     * Onboard a registered TAO or TI: create the back-office's keys it will list in its own DID
     * document, and issue its accreditation, which it then downloads and stores in EBSI itself.
     * @param id - Registered TAO or TI UUID.
     * @param actor - Registering account ID, or omitted for explicit synchronization.
     * @returns Completion once the keys exist and the accreditation is issued.
     * @throws Error for unavailable KMS, an accreditor not in the registry yet or unresolved key
     * creation; database/crypto errors.
     * @remarks Attempts for one organization queue here, in this process, rather than on pooled
     * sessions: the attempt holding the session lock needs further sessions for registry writes.
     */
    async onboard(id: string, actor?: number) {
      const previous = onboarding.get(id);
      const attempt = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => onboardOrganization(id, actor));
      onboarding.set(id, attempt);
      try {
        await attempt;
      } finally {
        if (onboarding.get(id) === attempt) onboarding.delete(id);
      }
    },
  };
}
