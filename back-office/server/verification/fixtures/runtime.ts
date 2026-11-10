import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { encodeBase58 } from 'ethers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mockFixture } from '../../issuance/fixtures/issuance.ts';
import {
  credentialHash,
  issuanceProtection,
  certificateStatusKey,
} from '../../issuance/protection.ts';
import { postgresAccounts } from '../../identity/auth/accounts.ts';
import { hashPassword } from '../../identity/auth/passwords.ts';
import { operatorTokens } from '../../identity/auth/tokens.ts';
import { postgresRelyingParties } from '../parties.ts';
import { verificationRegistry } from '../registry.ts';
import { postgresCertificationBody } from '../certification-body.ts';
import { verificationService } from '../service.ts';
import { verificationHttp } from '../http.ts';
import { postgresRegistrationThrottle } from '../../accreditation/registration-throttle.ts';
import { redisExchangeCache } from '../exchange-cache.ts';
import type { LedgerStatus } from '../../issuance/types.ts';

/** Public synthetic credentials used by isolated server and real-API browser checks. */
export const verificationPassword = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';

/**
 * Create a holder binding key in the actual Wallet's canonical did:key representation.
 * @returns Synthetic public DID and ES256 key pair.
 * @throws EC key-generation/export errors.
 */
export async function verificationHolder() {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const { crv, kty, x, y } = await exportJWK(pair.publicKey);
  const did =
    'did:key:z' +
    encodeBase58(
      Buffer.concat([
        Buffer.from([0xd1, 0xd6, 3]),
        Buffer.from(JSON.stringify({ crv, kty, x, y })),
      ]),
    );
  return { ...pair, did };
}

/**
 * Provision synthetic verifier accounts and historical credentials with real development registry HTTP.
 * @param origin - Replacement API origin used by the Wallet protocol.
 * @param prefix - Unique synthetic account namespace.
 * @returns Real service/HTTP dependencies, protocol-shaped signed credentials and explicit dependency fault controls.
 * @throws Database, Redis, registry or cryptographic errors.
 * @remarks KMS is replaced by local real EC signing; ledger tuples/faults are stored only in this disposable fixture table.
 */
export async function verificationFixture(origin: string, prefix = 'stage4-' + randomUUID()) {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const base = process.env.BACK_OFFICE_TEST_EBSI_URL;
  const redisUrl = process.env.BACK_OFFICE_TEST_REDIS_URL;
  assert.ok(
    base && redisUrl,
    'Verification checks require the isolated development EBSI and Redis.',
  );
  const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
  const id = randomUUID();
  const did = 'did:ebsi:zVerify' + id.replaceAll('-', '').replaceAll('0', '1');
  const type = 'CybersecurityManagerCertificate';
  const types = ['VerifiableCredential', 'VerifiableAttestation', type];
  const schemaId = 'zVerify' + id.replaceAll('-', '');
  const schemaUrl = base + '/v1/schemas-registry/schemas/' + schemaId;
  // A fabricated trust chain on the test ledger, through the development EBSI service.
  const seed = await mockFixture(base, '/__mock/seed', {
    trustedIssuer: did,
    tao: did + 'Tao',
    rootTao: did + 'Root',
    accreditedFor: [{ schemaId: schemaUrl, types }],
    schemas: {
      [schemaId]: {
        type: 'object',
        required: ['credentialSubject'],
        properties: {
          credentialSubject: {
            type: 'object',
            required: ['certificateNumber'],
            properties: { certificateNumber: { type: 'string', pattern: '^STAGE4-' } },
          },
        },
      },
    },
  });
  const old = await generateKeyPair('ES256', { extractable: true });
  const current = await generateKeyPair('ES256', { extractable: true });
  const issuedAt = new Date(Date.now() - 10 * 86400_000);
  const changedAt = new Date(Date.now() - 86400_000);
  const oldKid = did + '#historical';
  const currentKid = did + '#current';
  await mockFixture(base, '/__mock/did-keys', {
    did,
    keys: [
      {
        kid: oldKid,
        publicKeyJwk: await exportJWK(old.publicKey),
        purposes: ['assertionMethod'],
        activatedAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
        retiredAt: changedAt.toISOString(),
      },
      {
        kid: currentKid,
        publicKeyJwk: await exportJWK(current.publicKey),
        purposes: ['assertionMethod'],
        activatedAt: changedAt.toISOString(),
        retiredAt: null,
      },
    ],
  });
  const holder = await verificationHolder();
  const otherHolder = await verificationHolder();
  const signing = {
    // The verifier's OpenID4VP client identifier is this DID; its current key signs requests.
    did,
    key: async () => ({
      kid: currentKid,
      publicJwk: await exportJWK(current.publicKey),
      sign: async (input: Buffer) => {
        const { sign, KeyObject } = await import('node:crypto');
        return sign('sha256', input, {
          key: KeyObject.from(current.privateKey),
          dsaEncoding: 'ieee-p1363',
        });
      },
    }),
    publicKeys: async () => [await exportJWK(current.publicKey)],
  };
  const table = 'verification_fixture_' + id.replaceAll('-', '');
  await database.query(
    `CREATE TABLE ${table}(key text PRIMARY KEY, record jsonb, mode text NOT NULL DEFAULT '')`,
  );
  const contract = '0x' + 'ab'.repeat(20);
  const ledger = {
    contract,
    /**
     * Read an exact synthetic ledger tuple or inject its configured transport failure.
     * @param key - Credential status key.
     * @returns Contract-shaped tuple, including an unknown standing when absent.
     * @throws Injected ledger outage or database errors.
     */
    async status(key: string): Promise<LedgerStatus> {
      const {
        rows: [row],
      } = await database.query(`SELECT * FROM ${table} WHERE key=$1`, [key]);
      if (row?.mode === 'outage') throw new Error('Injected ledger unavailable');
      const record = row?.record ?? {};
      return {
        ...record,
        standing: BigInt(record.standing ?? 0),
        issuerDid: record.issuerDid ?? '',
        credentialHash: record.credentialHash ?? '0x' + '00'.repeat(32),
        validFrom: BigInt(record.validFrom ?? 0),
        validUntil: BigInt(record.validUntil ?? 0),
        registeredAt: BigInt(record.registeredAt ?? 0),
        changedAt: BigInt(record.changedAt ?? 0),
      };
    },
  };
  const privateProtection = issuanceProtection(Buffer.alloc(32, 84));
  const cache = await redisExchangeCache(redisUrl);
  const state = { registryDown: '', reads: [] as string[] };
  const registryReader = verificationRegistry({
    didr: base + '/v1/did-registry/identifiers',
    tir: base + '/v1/issuers-registry',
    tsr: base + '/v1/schemas-registry',
    roots: [seed.supportOffice],
    didSeconds: 0,
    trustSeconds: 0,
    schemaSeconds: 0,
    fetchRegistry: async (url, init) => {
      state.reads.push(String(url));
      if (state.registryDown && String(url).includes(state.registryDown))
        return new Response('{}', { status: 503 });
      return fetch(url, init);
    },
  });
  const service = verificationService(database, {
    origin,
    signing,
    ledger,
    registry: registryReader,
    protection: privateProtection,
    cache: cache.cache,
    certificationBody: postgresCertificationBody(database),
    exchangeNetworks: '127.0.0.0/8,::1/128',
  });
  const parties = postgresRelyingParties(database);
  const firstParty = await parties.create(prefix + ' employer');
  const secondParty = await parties.create(prefix + ' other');
  const secret = 'verification-fixture-only-access-secret-value:' + id;
  const partyLimit = postgresRegistrationThrottle(database, secret, '120/min');
  const mobileLimit = postgresRegistrationThrottle(database, secret, '20/min');
  const verification = {
    service,
    purgeAttributes: service.purgeAttributes,
    close: cache.close,
    publicHttp: verificationHttp(service, {
      parties,
      partyThrottle: (key) => partyLimit('party:' + key),
      mobileThrottle: (key) => mobileLimit('mobile:' + key),
    }),
  };
  const accounts: number[] = [];
  const hash = await hashPassword(verificationPassword);
  for (const suffix of ['verifier', 'other', 'unprivileged']) {
    const {
      rows: [account],
    } = await database.query(
      'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
      [prefix + '.' + suffix, hash],
    );
    accounts.push(account.id);
    if (suffix !== 'unprivileged')
      await database.query("INSERT INTO operator_roles VALUES($1,'plr_verifier')", [account.id]);
  }
  const tokens = operatorTokens(secret);
  const accountStore = postgresAccounts(database);
  const access = await Promise.all(
    accounts.map(async (id) => (await tokens.pair((await accountStore.byId(id))!)).access),
  );
  let counter = 0;

  /**
   * Sign a protocol-shaped historical JWT-VC and register the exact synthetic ledger tuple.
   * @param changes - Credential overrides for refusal cases, applied before signing.
   * @param sd - Whether ordinary attributes are selectively disclosed.
   * @returns Signed credential, disclosures, VC and exact ledger key.
   * @throws Cryptographic or disposable-database errors.
   */
  async function credential(changes: Record<string, any> = {}, sd = true) {
    const number = 'STAGE4-' + ++counter;
    const from = new Date(Math.floor(+issuedAt / 1000) * 1000).toISOString();
    const until = new Date(Math.floor((Date.now() + 365 * 86400_000) / 1000) * 1000).toISOString();
    const attributes = {
      certificateTitle: 'Osvedčenie',
      holderName: 'Ada Lovelace',
      certificationBody: 'Fixture TI',
    };
    const disclosures = sd
      ? Object.entries(attributes).map(([name, value]) =>
          Buffer.from(JSON.stringify(['fixture-' + randomUUID(), name, value])).toString(
            'base64url',
          ),
        )
      : [];
    const subject = {
      id: holder.did,
      certificateNumber: number,
      ...(sd
        ? {
            _sd: disclosures
              .map((value) => createHash('sha256').update(value).digest('base64url'))
              .sort(),
          }
        : attributes),
    };
    const vc = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: 'urn:uuid:' + randomUUID(),
      issuer: did,
      type: types,
      issuanceDate: from,
      validFrom: from,
      validUntil: until,
      expirationDate: until,
      credentialSubject: subject,
      credentialSchema: [{ id: schemaUrl, type: 'FullJsonSchemaValidator2021' }],
      // The registry only: the record's key follows from the issuer and the id.
      credentialStatus: [
        { id: 'eip155:1337:' + contract, type: 'PlrLedgerStatusEntry', contract, chainId: 1337 },
      ],
      termsOfUse: {
        type: 'IssuanceCertificate',
        id:
          base +
          '/v1/issuers-registry/issuers/' +
          did +
          '/attributes/' +
          seed.attributes.trustedIssuer,
      },
      ...changes,
    };
    const jwt = await new SignJWT({
      iss: did,
      sub: holder.did,
      vc,
      ...(sd ? { _sd_alg: 'sha-256' } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: oldKid })
      .sign(old.privateKey);
    const token = disclosures.length ? jwt + '~' + disclosures.join('~') + '~' : jwt;
    const key = '0x' + certificateStatusKey(String(vc.issuer), String(vc.id)).toString('hex');
    // What the certificate registry records at collection.
    const record = {
      standing: '1',
      issuerDid: did,
      credentialHash: '0x' + credentialHash(jwt).toString('hex'),
      validFrom: Math.floor(Date.parse(vc.validFrom) / 1000),
      validUntil: Math.floor(Date.parse(vc.validUntil) / 1000),
      registeredAt: Math.floor(Date.now() / 1000),
      changedAt: Math.floor(Date.now() / 1000),
    };
    await database.query(`INSERT INTO ${table}(key,record) VALUES($1,$2)`, [key, record]);
    return { token, jwt, disclosures, vc, key, record };
  }

  /**
   * Sign a Wallet-compatible VP for an actual request object.
   * @param request - Retrieved signed request claims or exchange challenge/domain projection.
   * @param credentials - Presented serialized credentials.
   * @param changes - Payload overrides for negative binding/time tests.
   * @param signer - Holder binding key; defaults to the issued subject.
   * @returns Signed JWT-VP.
   * @throws ES256 signing errors.
   */
  async function presentation(
    request: Record<string, any>,
    credentials: string[],
    changes: Record<string, any> = {},
    signer = holder,
  ) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: signer.did,
      sub: signer.did,
      aud: request.client_id ?? request.domain,
      nonce: request.nonce ?? request.challenge,
      ...(request.state ? { state: request.state } : {}),
      iat: now,
      nbf: now,
      exp: now + (request.state ? 900 : 300),
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: signer.did,
        verifiableCredential: credentials,
      },
      ...changes,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: signer.did })
      .sign(signer.privateKey);
  }

  return {
    database,
    service,
    verification,
    parties,
    firstParty,
    secondParty,
    accounts,
    access,
    tokens,
    accountStore,
    signing,
    state,
    holder,
    otherHolder,
    did,
    type,
    types,
    schemaUrl,
    oldKid,
    old,
    current,
    currentKid,
    changedAt,
    issuedAt,
    base,
    registryReader,
    ledger,
    table,
    contract,
    credential,
    presentation,
    /**
     * Remove only this fixture's mutable rows and owned connections.
     * @returns Completion after isolated test cleanup.
     * @throws Database/cache cleanup errors.
     */
    async close() {
      await database.query(
        'DELETE FROM presentation_results WHERE state IN(SELECT state FROM presentation_requests WHERE owner_id=ANY($1::int[]) OR relying_party_id=ANY($2::uuid[]))',
        [accounts, [firstParty.party.id, secondParty.party.id]],
      );
      await database.query('DELETE FROM relying_parties WHERE id=ANY($1::uuid[])', [
        [firstParty.party.id, secondParty.party.id],
      ]);
      await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::int[])', [accounts]);
      await database.query(`DROP TABLE ${table}`);
      await cache.close();
      await database.end();
    },
  };
}
