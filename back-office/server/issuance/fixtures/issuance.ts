import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { createIssuer } from '../issuer.ts';
import { issuanceProtection } from '../protection.ts';
import { postgresKmsIssuerSigning, postgresAuthorizationSigning } from '../kms-signing.ts';
import { ebsiIssuerTrust } from '../ebsi-trust.ts';
import { kmsCeremonyFixture } from '../../keys/fixtures/kms-ceremony.ts';
import { kmsKeyCeremony } from '../../keys/kms-provider.ts';
import { postgresOrganizationOnboarding } from '../../accreditation/onboarding.ts';
import { trustedSchemaRegistry } from '../../schemas/tsr.ts';
import {
  accreditationSchemaId,
  credentialSchemaDocument,
  ledgerStatusEntrySchemaId,
  synchronizeSchemas,
} from '../../schemas/publication.ts';
import { configuredEbsi } from '../../ebsi/runtime.ts';
import { testLedger } from '../../lifecycle/fixtures/ledger.ts';
import { tsrCredentialValidation } from '../../verification/schema-validation.ts';
import { hashPassword } from '../../identity/auth/passwords.ts';
import type { SchemaField } from '../../schemas/types.ts';
import type { LedgerRegistration } from '../types.ts';

/** Existing form fields shared by isolated browser and server issuance checks. */
export const issuanceFields: SchemaField[] = [
  {
    key: 'certificateNumber',
    kind: 'text',
    section: 'certificate',
    required: true,
    default: '',
    organization: false,
    label: { sk: 'Číslo osvedčenia', en: 'Certificate number' },
    hint: { sk: '', en: '' },
  },
  {
    key: 'holderName',
    kind: 'text',
    section: 'holder',
    required: true,
    default: '',
    organization: false,
    label: { sk: 'Meno držiteľa', en: 'Holder name' },
    hint: { sk: '', en: '' },
  },
  {
    key: 'trainingDays',
    kind: 'integer',
    section: 'training',
    required: true,
    default: '3',
    organization: false,
    label: { sk: 'Počet dní', en: 'Days' },
    hint: { sk: '', en: '' },
  },
  {
    key: 'certificationBody',
    kind: 'text',
    section: 'certificate',
    required: true,
    default: '',
    organization: true,
    label: { sk: 'Vydavateľ', en: 'Issuer' },
    hint: { sk: '', en: '' },
  },
];
export const issuancePassword = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';

/**
 * A development EBSI service's test helper (infra/ebsi-mock, /__mock/...).
 * @param base - The service's base URL.
 * @param path - The helper's path.
 * @param body - Its JSON body.
 * @returns The JSON answer.
 * @throws Error for a refusal.
 */
export async function mockFixture(base: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const answer = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(answer)}`);
  return answer;
}

/**
 * Provision only synthetic data, onboarded through EBSI's Core API v1 as in production: the
 * development EBSI service over the test ledger, and EC-backed KMS commands.
 * @param origin - Loopback/public issuer origin used in offers and holder proofs.
 * @param prefix - Unique synthetic account namespace, stable for the browser server.
 * @returns The production issuer, pool, accounts, fault controls and owned-data cleanup.
 * @throws Assertion, database, registry, ceremony or crypto errors.
 * @remarks The certificate registry is an exact-record in-memory adapter with explicit
 * partial-failure controls. Mail is absent.
 */
export async function issuanceFixture(origin: string, prefix = 'stage3-' + randomUUID()) {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const base = process.env.BACK_OFFICE_TEST_EBSI_URL;
  assert.ok(base, 'Stage 3 checks require the isolated development EBSI mock.');
  const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const schema = randomUUID();
  const type = 'Issuance' + schema.replaceAll('-', '') + 'Certificate';
  const organizations = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const authorizationDid = 'did:ebsi:zAuth' + schema.replaceAll('-', '').replaceAll('0', '1');
  const accounts: number[] = [];
  const tirUrl = base + '/v1/issuers-registry';
  const schemas = trustedSchemaRegistry(base + '/v1/schemas-registry');
  const tsr = 'zPlr' + type + 'V1';
  const network = await testLedger();
  const kms = kmsCeremonyFixture();
  // EBSI's Core API v1 as production uses it; the Support Office's own acts through /__mock.
  const ebsi = configuredEbsi(
    database,
    {
      PLR_LEDGER_RPC_URL: base + '/v1/ledger',
      PLR_LEDGER_CHAIN_ID: String(network.chainId),
      PLR_EBSI_URL: base,
      PLR_EBSI_MOCK_URL: base,
      AWS_REGION: 'eu-central-1',
    },
    [network.governance, network.registry],
    kms.client,
  )!;
  // The test ledger mines at once; look for receipts often rather than every 4 s.
  ebsi.provider.pollingInterval = 200;
  await mockFixture(base, '/__mock/support-office/schemas', {
    schemaId: tsr,
    schema: credentialSchemaDocument({
      credential_type: type,
      name: { sk: 'Test osvedčenie', en: 'Test certificate' },
      pending_version: 1,
      versions: [{ version: 1, fields: issuanceFields, tsr_id: tsr, registered_at: null }],
    }),
  });
  await synchronizeSchemas(database, ebsi.supportOffice!);
  const trust = ebsiIssuerTrust({
    tirUrl,
    didRegistryUrl: base + '/v1/did-registry/identifiers',
    trustedRoots: ['did:ebsi:zSupport'],
  });
  const onboarding = postgresOrganizationOnboarding(database, {
    keys: kmsKeyCeremony(kms.client),
    publication: {
      ebsi,
      tirUrl,
      accreditationSchema: schemas.address(accreditationSchemaId),
    },
    schemaAddress: schemas.address,
  });
  const state = {
    signCalls: 0,
    ledgerCalls: 0,
    failSign: false,
    loseSignResponse: false,
    failLedger: false,
    loseLedgerResponse: false,
    validationFailure: false,
    gate: undefined as (() => Promise<void>) | undefined,
  };
  const records = new Map<string, LedgerRegistration>();
  const protection = issuanceProtection(Buffer.alloc(32, 73));
  const keyLoader = postgresKmsIssuerSigning(database, kms.client, trust.assertionKey, database);
  const authorizationKeys = postgresAuthorizationSigning(database, keyLoader, authorizationDid);
  const authorization = {
    ...authorizationKeys,
    /**
     * Sign registry tokens through the real KMS adapter with test-only signing input capture.
     * @param client - Token-exchange transaction retaining the key lock.
     * @returns The registry key with in-memory KMS signing transport.
     * @throws Database, DID-resolution and key-loading errors.
     */
    async key(client?: PoolClient) {
      const key = await authorizationKeys.key(client);
      return {
        ...key,
        /**
         * Capture token bytes for the isolated KMS transport and sign them.
         * @param input - Exact token signing bytes.
         * @returns Verified ES256 signature.
         * @throws Fixture KMS or signature verification errors.
         */
        async sign(input: Buffer) {
          kms.state.signingInput = Buffer.from(input);
          return key.sign(input);
        },
      };
    },
  };
  const validate = tsrCredentialValidation(schemas);
  const issuer = createIssuer(database, {
    publicOrigin: origin,
    authorization,
    protection,
    schemaAddress: schemas.address,
    ensureAccredited: trust.ensureAccredited,
    ensureIssuer: onboarding.onboard,
    accreditationAddress: trust.accreditationAddress,
    ledgerStatusSchema: schemas.address(ledgerStatusEntrySchemaId),
    /**
     * Validate with the real development TSR, with an explicit outage control.
     * @param credential - Full credential before selective disclosure.
     * @param references - Declared trusted schema addresses.
     * @returns Completion after every schema accepts the credential.
     * @throws Injected refusal, registry or schema-validation errors.
     */
    async validateCredential(credential, references) {
      if (state.validationFailure) throw new Error('Injected TSR refusal');
      await validate(credential, references);
    },
    /**
     * Resolve the actual production KMS key loader against synthetic key storage.
     * @param did - Issuer DID.
     * @param organization - TI UUID.
     * @param client - Collection transaction retaining the key lock.
     * @returns Published key and controlled EC signing operation.
     * @throws Key-loading, publication or database errors.
     */
    async signingKey(did, organization, client) {
      const key = await keyLoader(did, organization, client);
      return {
        kid: key.kid,
        /**
         * Execute real EC signing behind the substituted AWS SDK transport.
         * @param input - JWT signing bytes.
         * @returns The verified JOSE signature.
         * @throws Injected failure or KMS/signature errors.
         */
        async sign(input) {
          state.signCalls++;
          await state.gate?.();
          if (state.failSign) throw new Error('Injected signing outage');
          kms.state.signingInput = Buffer.from(input);
          const signature = await key.sign(input);
          if (state.loseSignResponse) {
            state.loseSignResponse = false;
            throw new Error('Signing response lost');
          }
          return signature;
        },
      };
    },
    ledger: {
      chainId: 1337,
      contract: '0x' + 'ab'.repeat(20),
      /**
       * Register or reconcile an exact synthetic ledger tuple.
       * @param record - Immutable identity, validity, commitment and standing.
       * @returns Completion after registration, except injected lost acknowledgements.
       * @throws Injected outage/response loss or assertion for mismatched retry data.
       */
      async ensureRegistered(record) {
        state.ledgerCalls++;
        if (state.failLedger) throw new Error('Injected ledger outage');
        const existing = records.get(record.statusKey);
        if (existing)
          assert.deepEqual(record, existing, 'Retry must match the complete ledger tuple.');
        records.set(record.statusKey, structuredClone(record));
        if (state.loseLedgerResponse) {
          state.loseLedgerResponse = false;
          throw new Error('Ledger response lost after commit');
        }
      },
    },
  });
  try {
    const hash = await hashPassword(issuancePassword);
    await database.query(
      "INSERT INTO accredited_organizations(id,name,kind,did) VALUES($1,'Registry authorization','rtao',$2)",
      [organizations[4], authorizationDid],
    );
    const ceremony = kmsKeyCeremony(kms.client);
    const locator = await ceremony.create('credential_signing', randomUUID());
    const material = await ceremony.inspect(locator, 'credential_signing');
    const authorizationKid = authorizationDid + '#' + material.thumbprint;
    await database.query(
      "INSERT INTO issuer_signing_keys(organization_id,kid,kms_key_id,public_jwk,purpose,active,activated_at) VALUES($1,$2,$3,$4,'credential_signing',true,clock_timestamp())",
      [organizations[4], authorizationKid, material.keyId, material.publicJwk],
    );
    await mockFixture(base, '/__mock/did-keys', {
      did: authorizationDid,
      keys: [
        {
          kid: authorizationKid,
          publicKeyJwk: material.publicJwk,
          purposes: ['assertionMethod'],
          activatedAt: new Date().toISOString(),
          retiredAt: null,
        },
      ],
    });
    for (const suffix of ['ti', 'other', 'observer'])
      accounts.push(
        (
          await database.query(
            'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
            [prefix + '.' + suffix, hash],
          )
        ).rows[0].id,
      );
    for (const actor of accounts.slice(0, 2))
      await database.query("INSERT INTO operator_roles VALUES($1,'plr_issuer')", [actor]);
    await database.query("INSERT INTO operator_roles VALUES($1,'plr_auditor')", [accounts[2]]);
    await database.query(
      "INSERT INTO accredited_organizations(id,name,kind) VALUES($1,'Stage 3 Root','rtao')",
      [organizations[0]],
    );
    await database.query(
      "INSERT INTO accredited_organizations(id,name,kind,parent_id) VALUES($1,'Stage 3 TAO','tao',$2)",
      [organizations[1], organizations[0]],
    );
    for (let i = 0; i < 2; i++)
      await database.query(
        "INSERT INTO accredited_organizations(id,name,kind,parent_id,account_id,accredited_until) VALUES($1,$2,'ti',$3,$4,now()+interval '1 year')",
        [
          organizations[i + 2],
          i === 0 ? 'Stage 3 Training Issuer' : 'Other issuer',
          organizations[1],
          accounts[i],
        ],
      );
    await database.query(
      'INSERT INTO certificate_schemas(id,credential_type,name_sk,name_en) VALUES($1,$2,$3,$4)',
      [schema, type, 'Test osvedčenie', 'Test certificate'],
    );
    await database.query(
      'INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,1,$2,$3,now())',
      [schema, JSON.stringify(issuanceFields), tsr],
    );
    await database.query(
      'INSERT INTO organization_certificate_schemas SELECT unnest($1::uuid[]),$2',
      [organizations.slice(1, 4), schema],
    );
  } catch (error) {
    await database.end();
    throw error;
  }
  return {
    database,
    issuer,
    authorization,
    protection,
    trust,
    schemas,
    ebsi,
    base,
    onboarding,
    kms,
    state,
    records,
    type,
    schema,
    tsr,
    organizations,
    accounts,
    prefix,
    /**
     * Remove this fixture's mutable synthetic rows and close its pool.
     * @returns Completion; immutable journal and timestamp intents deliberately remain.
     * @throws Database errors if fixture cleanup fails.
     */
    async close() {
      try {
        await database.query(
          'DELETE FROM registered_certificates WHERE issuer_id=ANY($1::uuid[])',
          [organizations],
        );
        await database.query(
          'DELETE FROM organization_key_requests WHERE organization_id=ANY($1::uuid[])',
          [organizations],
        );
        await database.query(
          'DELETE FROM signing_key_provisions WHERE organization_id=ANY($1::uuid[])',
          [organizations],
        );
        await database.query(
          'DELETE FROM issuer_signing_keys WHERE organization_id=ANY($1::uuid[])',
          [organizations],
        );
        await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
          organizations,
        ]);
        await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::int[])', [accounts]);
        await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [
          schema,
        ]);
        await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
      } finally {
        ebsi.close();
        await database.end();
      }
    },
  };
}
