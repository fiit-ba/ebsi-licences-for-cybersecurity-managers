import assert from 'node:assert/strict';
import { randomUUID, KeyObject, sign } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { encodeBase58 } from 'ethers';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from 'jose';
import pg from 'pg';
import { createIssuer } from '../issuance/issuer.ts';
import { authorizationFixture } from '../issuance/fixtures/authorization.ts';
import { issuanceProtection, preAuthorizedGrant } from '../issuance/protection.ts';
import { postgresStatusProposals } from './proposals.ts';
import { postgresGovernanceDelivery } from './delivery.ts';
import { postgresEmergencySuspension } from './emergency.ts';
import { configuredLocalLifecycle } from './runtime.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';

test('pre-collection decisions apply locally and reach the record at collection, while explicit local mode applies independent decisions atomically', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'precollection-' + randomUUID();
  const organizations = [randomUUID(), randomUUID(), randomUUID()];
  const schema = randomUUID();
  const certificates: string[] = [];
  const actors: number[] = [];
  context.after(async () => {
    try {
      await database.query(
        'DELETE FROM certificate_status_proposals WHERE certificate_id = ANY($1::uuid[])',
        [certificates],
      );
      await database.query(
        'DELETE FROM certificate_emergency_suspensions WHERE certificate_id = ANY($1::uuid[])',
        [certificates],
      );
      await database.query('DELETE FROM registered_certificates WHERE id = ANY($1::uuid[])', [
        certificates,
      ]);
      await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [schema]);
      await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
      await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::int[])', [actors]);
    } finally {
      await database.end();
    }
  });
  for (let index = 0; index < 2; index++) {
    const actor = (
      await database.query<{ id: number }>(
        'INSERT INTO operator_accounts (username,password_hash) VALUES ($1,$2) RETURNING id',
        [prefix + index, 'unused-hash'],
      )
    ).rows[0].id;
    actors.push(actor);
    await database.query("INSERT INTO operator_roles VALUES ($1,'plr_status_manager')", [actor]);
  }
  await database.query("INSERT INTO operator_roles VALUES ($1,'plr_issuer')", [actors[0]]);
  await database.query(
    "INSERT INTO accredited_organizations (id,name,kind) VALUES ($1,'Root','rtao')",
    [organizations[0]],
  );
  await database.query(
    "INSERT INTO accredited_organizations (id,name,kind,parent_id) VALUES ($1,'TAO','tao',$2)",
    [organizations[1], organizations[0]],
  );
  await database.query(
    `INSERT INTO accredited_organizations (id,name,kind,parent_id,account_id,did,tir_attribute_id,accredited_until)
    VALUES ($1,'TI','ti',$2,$3,'did:ebsi:zPrecollection','fixture',now()+interval '1 year')`,
    [organizations[2], organizations[1], actors[0]],
  );
  await database.query(
    'INSERT INTO certificate_schemas (id,credential_type,name_sk) VALUES ($1,$2,$3)',
    [schema, prefix, 'Lifecycle fixture'],
  );
  await database.query(
    `INSERT INTO certificate_schema_versions (schema_id,version,fields,tsr_id,registered_at)
    VALUES ($1,1,'[{"key":"certificateNumber","kind":"text","required":true}]','fixture',now())`,
    [schema],
  );
  await database.query(
    'INSERT INTO organization_certificate_schemas SELECT unnest($1::uuid[]),$2',
    [organizations.slice(1), schema],
  );

  const protection = issuanceProtection(Buffer.alloc(32, 23));
  const origin = 'https://issuer.example';
  const issuerKeys = await generateKeyPair('ES256', { extractable: true });
  const holderKeys = await generateKeyPair('ES256', { extractable: true });
  const { crv, kty, x, y } = await exportJWK(holderKeys.publicKey);
  const fingerprint =
    'z' +
    encodeBase58(
      Buffer.concat([
        Buffer.from([0xd1, 0xd6, 3]),
        Buffer.from(JSON.stringify({ crv, kty, x, y })),
      ]),
    );
  const did = 'did:key:' + fingerprint;
  const records = new Map<string, Record<string, unknown>>();
  let signCount = 0;
  let signingGate: (() => Promise<void>) | undefined;
  const issuer = createIssuer(database, {
    authorization: await authorizationFixture(),
    protection,
    publicOrigin: origin,
    ensureAccredited: async () => undefined,
    signingKey: async () => ({
      kid: 'did:ebsi:zPrecollection#key',
      sign: async (input: Buffer) => {
        signCount++;
        await signingGate?.();
        return sign('sha256', input, {
          key: KeyObject.from(issuerKeys.privateKey),
          dsaEncoding: 'ieee-p1363',
        });
      },
    }),
    ledger: {
      chainId: 1337,
      contract: '0x' + 'ab'.repeat(20),
      async ensureRegistered(record) {
        const existing = records.get(record.id);
        if (existing)
          assert.deepEqual(
            existing,
            record,
            'Registration must preserve exact standing and immutable fields.',
          );
        records.set(record.id, { ...record });
      },
    },
    schemaAddress: () => 'https://tsr.example/schema',
    ledgerStatusSchema: 'https://tsr.example/status',
    accreditationAddress: () => 'https://tir.example/attribute',
  });
  const governance = postgresStatusProposals(database);
  const emergency = postgresEmergencySuspension(database);
  const local = configuredLocalLifecycle(
    database,
    {
      BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED: 'true',
    },
    protection,
  );
  assert.ok(local);
  assert.equal(configuredLocalLifecycle(database, {}), undefined);
  assert.throws(
    () => configuredLocalLifecycle(database, { BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED: 'yes' }),
    /true or false/,
  );
  assert.throws(
    () =>
      configuredLocalLifecycle(database, {
        BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED: 'true',
        PLR_GOVERNANCE_CONTRACT: 'configured',
      }),
    /no governance contract/,
  );
  assert.throws(
    () =>
      configuredLocalLifecycle(database, {
        BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED: 'true',
        BACK_OFFICE_ISSUANCE_ENABLED: 'true',
      }),
    /disabled ledger issuance/,
  );

  /** Register encrypted claims using the production registration operation.
   * @param number - Unique certificate number for this scenario.
   * @returns One-time holder handoff details.
   * @throws Database, validation or fixture-trust errors.
   */
  async function register(number: string) {
    const offer = await issuer.registration.register(actors[0], {
      holder_reference: number,
      credential_type: prefix,
      claims: { certificateNumber: number },
    });
    certificates.push(offer.certificate_id);
    return offer;
  }
  /** Exchange the real PIN (tx_code) and prove the holder key for a fresh c_nonce.
   * @param offer - Holder offer returned by registration.
   * @returns A bearer token and proof bound to that certificate.
   * @throws Assertion, JWT signing, database or token-exchange errors.
   */
  async function handoff(offer) {
    const code = new URL(
      new URL(offer.offer_uri).searchParams.get('credential_offer_uri')!,
    ).pathname
      .split('/')
      .at(-1);
    const exchanged = await issuer.tokens.exchange({
      grant_type: preAuthorizedGrant,
      'pre-authorized_code': code,
      tx_code: offer.pin,
    });
    assert.equal(exchanged.status, 200);
    // OpenID4VCI 1.0: the c_nonce from the Nonce Endpoint; no iss after anonymous access.
    const proof = await new SignJWT({ nonce: (await issuer.nonces.issue()).nonce })
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'openid4vci-proof+jwt',
        kid: did + '#' + fingerprint,
      })
      .setAudience(origin)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(holderKeys.privateKey);
    return {
      token: exchanged.body.access_token,
      input: { credential_configuration_id: prefix, proofs: { jwt: [proof] } },
    };
  }
  const propose = (service, offer, action = 'suspend') =>
    service.propose(actors[0], {
      credential_id: offer.credential_id,
      action,
      reason_code: 'other',
      reason_note: 'Lifecycle evidence',
    });
  let deliveryCalls = 0;
  let loseResponse = false;
  const deliver = postgresGovernanceDelivery(
    database,
    {
      chainId: 1337,
      contract: '0x' + 'ab'.repeat(20),
      async advance(record) {
        deliveryCalls++;
        assert.ok(records.has(record.credentialId), 'Only a collected certificate has a case.');
        if (loseResponse) throw new Error('Execution response lost');
        const existing = records.get(record.credentialId);
        if (existing)
          existing.standing =
            record.action === 'suspend'
              ? 'suspended'
              : record.action === 'revoke'
                ? 'revoked'
                : 'active';
        return { id: String(deliveryCalls), state: 'executed' as const };
      },
      async withdraw() {
        assert.fail('No withdrawal in this fixture.');
      },
    },
    protection,
  );

  const pending = await register('PRE-GOVERNANCE');
  const proposal = await propose(governance, pending);
  await assert.rejects(governance.decide(actors[0], proposal.proposal_id, 'approved'), {
    body: {
      reason: 'FourEyes',
      detail: 'The approver must be a different person from the proposer.',
    },
  });
  // No record exists before collection, so the decision applies locally, at once.
  assert.equal(
    (await governance.decide(actors[1], proposal.proposal_id, 'approved')).applied,
    true,
  );
  await deliver();
  assert.equal(deliveryCalls, 0, 'An uncollected certificate has no record to propose for.');
  assert.equal(records.size, 0, 'A decision must not publish an uncollected certificate record.');
  const issued = await handoff(pending);
  const collected = await issuer.redemption.redeem(issued.token, issued.input);
  assert.equal(collected.status, 200);
  assert.equal(records.size, 0);
  await issuer.deliverRegistrations();
  const collectedCredential = collected.body.credentials[0].credential;
  const collectedId = JSON.parse(
    Buffer.from(collectedCredential.split('.')[1], 'base64url').toString(),
  ).jti;
  // The record carries the decision made before collection.
  assert.equal(records.get(collectedId)?.standing, 'suspended');
  await jwtVerify(collectedCredential.split('~')[0], issuerKeys.publicKey, {
    issuer: 'did:ebsi:zPrecollection',
    subject: did,
  });
  assert.equal(
    (
      await database.query('SELECT ledger_standing FROM registered_certificates WHERE id=$1', [
        pending.certificate_id,
      ])
    ).rows[0].ledger_standing,
    'suspended',
  );

  const incident = await register('PRE-EMERGENCY');
  const protective = await emergency(actors[0], { credential_id: incident.credential_id });
  assert.equal(protective.awaiting, null);
  const beforeDelivery = deliveryCalls;
  await deliver();
  assert.equal(deliveryCalls, beforeDelivery);
  const incidentToken = await handoff(incident);
  assert.equal(
    (await issuer.redemption.redeem(incidentToken.token, incidentToken.input)).status,
    200,
  );
  await issuer.deliverRegistrations();
  const incidentId = (
    await database.query('SELECT credential_id FROM registered_certificates WHERE id=$1', [
      incident.certificate_id,
    ])
  ).rows[0].credential_id;
  assert.equal(records.get(incidentId)?.standing, 'suspended');

  // A revocation before collection is local as well: nothing reaches the governance worker,
  // even when it would lose responses, and the record is registered revoked.
  const uncertain = await register('PRE-UNCERTAIN');
  const unknown = await propose(governance, uncertain, 'revoke');
  assert.equal((await governance.decide(actors[1], unknown.proposal_id, 'approved')).applied, true);
  loseResponse = true;
  const beforeRevocation = deliveryCalls;
  await deliver();
  assert.equal(deliveryCalls, beforeRevocation);
  loseResponse = false;
  const uncertainToken = await handoff(uncertain);
  assert.equal(
    (await issuer.redemption.redeem(uncertainToken.token, uncertainToken.input)).status,
    200,
  );
  await issuer.deliverRegistrations();
  const uncertainId = (
    await database.query('SELECT credential_id FROM registered_certificates WHERE id=$1', [
      uncertain.certificate_id,
    ])
  ).rows[0].credential_id;
  assert.equal(records.get(uncertainId)?.standing, 'revoked');

  const localOffer = await register('LOCAL-DECISION');
  // Before collection every decision is local, in either mode: the case is the local
  // lifecycle's to decide, through its own API.
  const localCase = await propose(local.statusProposals, localOffer);
  const tokens = operatorTokens('local-lifecycle-test-only-token-secret');
  const bearer = (await tokens.pair({ id: actors[1] })).access;
  const server = backOfficeServer({ accounts: postgresAccounts(database), tokens, ...local });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const approvals = await Promise.all(
    [0, 1].map(() =>
      fetch(api + '/registry/approve/', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ proposal_id: localCase.proposal_id }),
      }),
    ),
  );
  assert.deepEqual(approvals.map((response) => response.status).sort(), [200, 403]);
  const applied = await approvals.find((response) => response.ok)!.json();
  assert.deepEqual([applied.applied, applied.awaiting, applied.state], [true, null, 'suspended']);
  const page = await (
    await fetch(api + '/registry/certificates/?q=LOCAL-DECISION', {
      headers: { authorization: 'Bearer ' + bearer },
    })
  ).json();
  assert.equal(page.results[0].state, 'suspended');
  assert.deepEqual(page.results[0].allowed_actions, ['reinstate', 'revoke']);
  const localRevoke = await propose(local.statusProposals, localOffer, 'revoke');
  assert.equal(
    (await local.statusProposals.decide(actors[1], localRevoke.proposal_id, 'approved')).state,
    'revoked',
  );
  const beforeLocal = deliveryCalls;
  await deliver();
  assert.equal(deliveryCalls, beforeLocal, 'Local decisions must never reach a governance worker.');
  assert.equal(records.has(localOffer.credential_id), false);

  const racing = await register('COLLECTION-RACE');
  const raceToken = await handoff(racing);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  signingGate = async () => {
    started();
    await blocked;
  };
  const redemption = issuer.redemption.redeem(raceToken.token, raceToken.input);
  await active;
  const suspension = emergency(actors[0], { credential_id: racing.credential_id });
  let observedWait = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const {
        rows: [waiting],
      } = await database.query<{ waiting: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%registered_certificates%') AS waiting`,
      );
      if (waiting.waiting) {
        observedWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    release();
  }
  assert.equal(
    observedWait,
    true,
    'The emergency must actually wait for the in-flight collection lock.',
  );
  assert.equal((await redemption).status, 200);
  assert.equal((await suspension).awaiting, 'governance contract');
  assert.equal(
    (
      await database.query(
        'SELECT applied_at FROM certificate_emergency_suspensions WHERE certificate_id=$1',
        [racing.certificate_id],
      )
    ).rows[0].applied_at,
    null,
  );
});
