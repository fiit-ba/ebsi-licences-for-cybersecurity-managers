import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { encodeBase58 } from 'ethers';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK } from 'jose';
import { issuanceFixture, mockFixture } from './fixtures/issuance.ts';
import {
  certificateStatusKey,
  issuanceProtection,
  preAuthorizedGrant,
  secretDigest,
} from './protection.ts';
import { postgresCertificateRegistration } from './registration.ts';
import { postgresCredentialTokenExchange } from './token-exchange.ts';
import { setTimeout } from 'node:timers/promises';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import type { AddressInfo } from 'node:net';
import { postgresAudit } from '../audit/service.ts';
import { postgresCertificateList } from '../lifecycle/certificates.ts';

test('certificate issuance and collection with real PostgreSQL, DID/TIR/TSR and KMS signing adapter', async (context) => {
  const origin = 'https://stage-three.example';
  const fixture = await issuanceFixture(origin);
  const { database, issuer, accounts, organizations, state, records, type, trust } = fixture;
  context.after(() => fixture.close());
  const holder = await generateKeyPair('ES256', { extractable: true });
  const { crv, kty, x, y } = await exportJWK(holder.publicKey);
  const did =
    'did:key:z' +
    encodeBase58(
      Buffer.concat([
        Buffer.from([0xd1, 0xd6, 3]),
        Buffer.from(JSON.stringify({ crv, kty, x, y })),
      ]),
    );
  const other = await generateKeyPair('ES256');
  let counter = 0;
  const register = (extra: Record<string, unknown> = {}) =>
    issuer.registration.register(accounts[0], {
      holder_reference: 'file-42',
      credential_type: type,
      claims: { certificateNumber: 'NUMBER-' + ++counter, holderName: '  Ada  ' },
      ...extra,
    });
  const code = (offer: { offer_uri: string }) =>
    new URL(new URL(offer.offer_uri).searchParams.get('credential_offer_uri')!).pathname
      .split('/')
      .at(-1)!;
  const exchange = (offer: { offer_uri: string; pin: string | null }) =>
    issuer.tokens.exchange({
      grant_type: preAuthorizedGrant,
      'pre-authorized_code': code(offer),
      tx_code: offer.pin,
    });
  // OpenID4VCI 1.0: a c_nonce from the Nonce Endpoint, and a jwt key proof without iss after
  // anonymous access with a pre-authorized code.
  const nonce = async () => (await issuer.nonces.issue()).nonce;
  const proof = async (
    value: string,
    changes: Record<string, unknown> = {},
    key = holder.privateKey,
  ) =>
    new SignJWT({
      aud: origin,
      nonce: value,
      iat: Date.now() / 1000,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...changes,
    })
      .setProtectedHeader({
        typ: 'openid4vci-proof+jwt',
        alg: 'ES256',
        kid: did + '#' + did.slice(8),
      })
      .sign(key);
  const request = async (_grant?: unknown, changes: Record<string, unknown> = {}) => ({
    credential_configuration_id: type,
    proofs: { jwt: [await proof(await nonce())] },
    ...changes,
  });
  /** The record key of a collected credential: its TI and its id. */
  const recordKey = (offer: { issuer_did: string }, credential: string) =>
    '0x' +
    certificateStatusKey(
      offer.issuer_did,
      JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString()).jti,
    ).toString('hex');

  await context.test(
    'on-demand onboarding, normalization, signature, validity, ledger and private-data boundary',
    async () => {
      assert.equal(fixture.kms.state.creates, 1);
      const offer = await register({ qr: true });
      // On-demand onboarding through EBSI's Core API v1: the RootTAO's and the TAO's three
      // keys, and the TI's five (its own A and B governance keys among them).
      assert.equal(fixture.kms.state.creates, 12);
      assert.match(offer.qr!, /^data:image\/png;base64,/);
      assert.equal(records.size, 0);
      const grant = (await exchange(offer)).body;
      assert.equal(grant.token_type, 'Bearer');
      assert.equal(grant.expires_in, 3600);
      assert.equal((grant as Record<string, unknown>).c_nonce, undefined);
      const authorizationPublic = (await fixture.authorization.publicKeys())[0];
      const authorizationToken = await jwtVerify(
        grant.access_token!,
        await importJWK(authorizationPublic, 'ES256'),
        { issuer: origin, audience: origin },
      );
      assert.equal(authorizationToken.protectedHeader.kid, authorizationPublic.kid);
      assert.equal(authorizationToken.payload.sub, code(offer));
      // Neither the PIN nor a nonce travels in the bearer token.
      assert.deepEqual(Object.keys(authorizationToken.payload).sort(), [
        'aud',
        'exp',
        'iss',
        'sub',
      ]);
      assert.ok(authorizationToken.payload.exp! > Date.now() + 3590000);
      assert.ok(authorizationToken.payload.exp! <= Date.now() + 3600000);
      const result = await issuer.redemption.redeem(grant.access_token, await request(grant));
      assert.equal(result.status, 200);
      const collected = result.body.credentials![0].credential;
      const [jwt, ...disclosures] = collected.split('~');
      const key = await trust.assertionKey(
        offer.issuer_did,
        JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString()).kid,
      );
      const { payload } = await jwtVerify(
        jwt,
        await (await import('jose')).importJWK(key, 'ES256'),
        { issuer: offer.issuer_did, subject: did },
      );
      assert.notEqual(payload.jti, offer.credential_id);
      assert.equal(
        records.size,
        0,
        'Collection returns the credential before asynchronous ledger registration.',
      );
      await issuer.deliverRegistrations();
      assert.equal(
        (payload.vc as any).credentialSubject.certificateNumber,
        offer.certificate_number,
      );
      const values = Object.fromEntries(
        disclosures
          .filter(Boolean)
          .map((value) => JSON.parse(Buffer.from(value, 'base64url').toString()).slice(1)),
      );
      assert.deepEqual(values, {
        holderName: 'Ada',
        trainingDays: 3,
        certificationBody: 'Stage 3 Training Issuer',
      });
      const stored = (
        await database.query(
          'SELECT c.* FROM registered_certificates c JOIN credential_tokens t ON t.certificate_id=c.id WHERE c.id=$1',
          [offer.certificate_id],
        )
      ).rows[0];
      assert.equal(
        (
          await database.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credential_tokens' AND column_name='holder_digest'",
          )
        ).rowCount,
        0,
      );
      assert.equal(stored.registered_id, offer.credential_id);
      assert.equal(stored.credential_id, payload.jti);
      for (const reference of [stored.credential_id, stored.registered_id]) {
        const listed = await postgresCertificateList(database, fixture.protection)(
          accounts[0],
          new URLSearchParams({ q: reference }),
        );
        assert.equal(listed.results.length, 1);
        assert.equal(listed.results[0].credential_id, stored.credential_id);
        assert.equal(listed.results[0].registered_id, stored.registered_id);
        const journal = await postgresAudit(database, fixture.protection).list(
          accounts[2],
          new URLSearchParams({ credential_id: reference }),
        );
        assert.ok(journal.results.some((entry) => entry.event === 'certificate.registered'));
        assert.ok(journal.results.some((entry) => entry.event === 'certificate.issued'));
      }
      assert.equal(payload.nbf, Math.floor(+stored.valid_from / 1000));
      assert.equal(payload.exp, Math.floor(+stored.valid_until / 1000));
      assert.equal((payload.exp as number) - (payload.nbf as number), 157680000);
      assert.equal(stored.private_data.includes(Buffer.from(did)), false);
      assert.equal(records.get(recordKey(offer, collected))?.validUntil, payload.exp);
      assert.ok(stored.ledger_registered_at);
      await database.query(
        "UPDATE registered_certificates SET ledger_standing=NULL,ledger_observed_at=NULL,local_standing='suspended' WHERE id=$1",
        [offer.certificate_id],
      );
      assert.equal(
        await issuer.deliverRegistrations(),
        0,
        'Later lifecycle observations must not restart initial issuance registration.',
      );
      assert.equal(records.get(recordKey(offer, collected))?.standing, 'active');
      assert.ok(
        (
          await database.query(
            'SELECT 1 FROM audit_entries a JOIN audit_anchors q ON q.entry_id=a.id WHERE a.credential_id=$1 AND a.event=$2',
            [offer.credential_id, 'certificate.registered'],
          )
        ).rowCount,
      );
    },
  );

  await context.test(
    'wrong/missing PIN, lockout, offer expiry and one-time exchange races',
    async () => {
      const offer = await register();
      const input = { grant_type: preAuthorizedGrant, 'pre-authorized_code': code(offer) };
      // A missing transaction code is an invalid request (OpenID4VCI 1.0, section 6.3).
      assert.equal((await issuer.tokens.exchange(input)).body.error, 'invalid_request');
      const wrong = offer.pin === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++)
        assert.equal(
          (await issuer.tokens.exchange({ ...input, tx_code: wrong })).body.error,
          'invalid_grant',
        );
      assert.equal((await exchange(offer)).status, 400);
      const fresh = await issuer.registration.reoffer(accounts[0], {
        credential_id: offer.credential_id,
      });
      assert.equal((await exchange(offer)).status, 400);
      const outcomes = await Promise.all([exchange(fresh), exchange(fresh)]);
      assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 400]);
      const expired = await register();
      await database.query(
        'UPDATE credential_offers SET expires_at=now() WHERE certificate_id=$1',
        [expired.certificate_id],
      );
      assert.equal(await issuer.registration.offer(code(expired)), undefined);
      assert.equal((await exchange(expired)).status, 400);
    },
  );

  await context.test(
    'holder proof refuses wrong signature, audience, nonce, age, format and type without signing',
    async () => {
      const grant = (await exchange(await register())).body;
      const signs = state.signCalls;
      const refusal = async (changes: Record<string, unknown>) =>
        (await issuer.redemption.redeem(grant.access_token, await request(grant, changes))).body
          .error;
      assert.equal(await refusal({ proofs: { jwt: [await proof('wrong')] } }), 'invalid_nonce');
      for (const item of [
        await proof(await nonce(), { aud: 'https://other.example' }),
        await proof(await nonce(), {
          exp: Math.floor(Date.now() / 1000) - 20,
          iat: Math.floor(Date.now() / 1000) - 400,
        }),
        await proof(await nonce(), {}, other.privateKey),
        await proof(await nonce(), { iss: did }),
      ])
        assert.equal(await refusal({ proofs: { jwt: [item] } }), 'invalid_proof');
      assert.equal(
        await refusal({ proofs: { jwt: [await proof(await nonce())], ldp_vp: ['x'] } }),
        'invalid_credential_request',
      );
      assert.equal(
        await refusal({ credential_configuration_id: 'OtherCertificate' }),
        'unknown_credential_configuration',
      );
      assert.equal(state.signCalls, signs);
    },
  );

  await context.test(
    'signature response loss retries without ledger writes or changing the verified holder',
    async () => {
      const offer = await register();
      const grant = (await exchange(offer)).body;
      const input = await request(grant);
      const calls = state.ledgerCalls;
      state.loseSignResponse = true;
      await assert.rejects(
        issuer.redemption.redeem(grant.access_token, input),
        /Signing response lost/,
      );
      assert.equal(state.ledgerCalls, calls);
      const grantState = (
        await database.query('SELECT redeemed_at FROM credential_tokens WHERE certificate_id=$1', [
          offer.certificate_id,
        ])
      ).rows[0];
      assert.equal(grantState.redeemed_at, null);
      assert.equal((await issuer.redemption.redeem(grant.access_token, input)).status, 200);
    },
  );

  await context.test(
    'expired grants can be reoffered and lost background ledger acknowledgements preserve the collected tuple',
    async () => {
      await issuer.deliverRegistrations();
      const offer = await register();
      const grant = (await exchange(offer)).body;
      const input = await request(grant);
      state.loseSignResponse = true;
      await assert.rejects(
        issuer.redemption.redeem(grant.access_token, input),
        /Signing response lost/,
      );
      await database.query(
        'UPDATE credential_tokens SET expires_at=now() WHERE certificate_id=$1',
        [offer.certificate_id],
      );
      const replacement = await issuer.registration.reoffer(accounts[0], {
        credential_id: offer.credential_id,
      });
      const recovered = (await exchange(replacement)).body;
      assert.equal((await issuer.redemption.redeem(grant.access_token, input)).status, 401);
      const outcomes = await Promise.all([
        issuer.redemption.redeem(recovered.access_token, await request(recovered)),
        issuer.redemption.redeem(recovered.access_token, await request(recovered)),
      ]);
      assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 401]);
      const won = outcomes.find((item) => item.status === 200)!.body.credentials![0].credential;
      state.loseLedgerResponse = true;
      await issuer.deliverRegistrations();
      const expected = structuredClone(records.get(recordKey(offer, won)));
      assert.ok(expected);
      await Promise.all([issuer.deliverRegistrations(), issuer.deliverRegistrations()]);
      assert.deepEqual(records.get(recordKey(offer, won)), expected);
      await assert.rejects(
        issuer.registration.reoffer(accounts[0], { credential_id: offer.credential_id }),
        (error) => (error as any).body.reason === 'OfferAlreadyRedeemed',
      );
    },
  );

  await context.test(
    'provider outages and schema mismatch do not consume the bound bearer',
    async () => {
      const offer = await register();
      const grant = (await exchange(offer)).body;
      const input = await request(grant);
      for (const field of ['validationFailure', 'failSign'] as const) {
        state[field] = true;
        await assert.rejects(issuer.redemption.redeem(grant.access_token, input));
        state[field] = false;
        assert.equal(
          (
            await database.query(
              'SELECT redeemed_at FROM credential_tokens WHERE certificate_id=$1',
              [offer.certificate_id],
            )
          ).rows[0].redeemed_at,
          null,
        );
      }
      state.failLedger = true;
      assert.equal((await issuer.redemption.redeem(grant.access_token, input)).status, 200);
      await issuer.deliverRegistrations();
      assert.equal(
        (
          await database.query('SELECT ledger_standing FROM registered_certificates WHERE id=$1', [
            offer.certificate_id,
          ])
        ).rows[0].ledger_standing,
        'unknown',
      );
      state.failLedger = false;
      await issuer.deliverRegistrations();
      assert.equal(
        (
          await database.query('SELECT ledger_standing FROM registered_certificates WHERE id=$1', [
            offer.certificate_id,
          ])
        ).rows[0].ledger_standing,
        'active',
      );
      // Deliberately discard a successful response. One-time use remains one-time;
      // no stored credential copy or second reoffer is invented for recovery.
      assert.equal((await issuer.redemption.redeem(grant.access_token, input)).status, 401);
    },
  );

  await context.test(
    'the actual trusted TSR must accept all claims before any signature',
    async () => {
      const original = await fixture.schemas.document(fixture.schemas.address(fixture.tsr));
      const offer = await register();
      const grant = (await exchange(offer)).body;
      const input = await request(grant);
      const before = state.signCalls;
      // A new revision in the TSR, as the Support Office registers one.
      const revise = (schema: unknown) =>
        mockFixture(fixture.base, '/__mock/support-office/schemas', {
          schemaId: fixture.tsr,
          schema,
        });
      assert.equal(
        (
          await revise({
            ...original,
            properties: {
              ...original.properties,
              credentialSubject: { type: 'object', required: ['notSupplied'] },
            },
          })
        ).registered,
        true,
      );
      try {
        await assert.rejects(issuer.redemption.redeem(grant.access_token, input), {
          code: 'SchemaMismatch',
        });
        assert.equal(state.signCalls, before);
      } finally {
        assert.equal((await revise(original)).registered, true);
      }
      assert.equal((await issuer.redemption.redeem(grant.access_token, input)).status, 200);
    },
  );

  await context.test(
    'explicit validity is preserved and default expiry starts at collection',
    async () => {
      const backdated = await register({
        valid_from: new Date(Date.now() - 86400000).toISOString(),
      });
      const backdatedGrant = (await exchange(backdated)).body;
      await assert.rejects(
        issuer.redemption.redeem(backdatedGrant.access_token, await request(backdatedGrant)),
        /validFrom.*before.*issuanceDate/,
      );
      const validFrom = new Date(Date.now() + 86400000);
      const before = Date.now();
      const offer = await register({ valid_from: validFrom.toISOString() });
      const grant = (await exchange(offer)).body;
      const result = await issuer.redemption.redeem(grant.access_token, await request(grant));
      assert.equal(result.status, 200);
      const row = (
        await database.query(
          'SELECT valid_from,valid_until FROM registered_certificates WHERE id=$1',
          [offer.certificate_id],
        )
      ).rows[0];
      assert.equal(+row.valid_from, +validFrom);
      assert.ok(+row.valid_until >= before - 1000 + 157680000000);
      assert.ok(+row.valid_until <= Date.now() + 157680000000);
      const until = new Date(Date.now() + 365 * 86400000);
      const explicit = await register({
        valid_from: validFrom.toISOString(),
        valid_until: until.toISOString(),
      });
      const explicitGrant = (await exchange(explicit)).body;
      assert.equal(
        (await issuer.redemption.redeem(explicitGrant.access_token, await request(explicitGrant)))
          .status,
        200,
      );
      const stored = (
        await database.query(
          'SELECT valid_from,valid_until FROM registered_certificates WHERE id=$1',
          [explicit.certificate_id],
        )
      ).rows[0];
      assert.equal(+stored.valid_from, +validFrom);
      assert.equal(+stored.valid_until, +until);
      const expired = await register();
      const expiredGrant = (await exchange(expired)).body;
      await database.query('UPDATE registered_certificates SET valid_until=now() WHERE id=$1', [
        expired.certificate_id,
      ]);
      assert.equal(
        (await issuer.redemption.redeem(expiredGrant.access_token, await request(expiredGrant)))
          .status,
        401,
      );
      await assert.rejects(
        issuer.registration.reoffer(accounts[0], { credential_id: expired.credential_id }),
        (error) => (error as any).body.reason === 'Expired',
      );
    },
  );

  await context.test(
    'issuer authority, ownership, schema version and duplicate-number races',
    async () => {
      const offer = await register();
      await assert.rejects(
        issuer.registration.reoffer(accounts[1], { credential_id: offer.credential_id }),
        (error) => (error as any).body.reason === 'NotOnboarded',
      );
      await fixture.onboarding.onboard(organizations[3]);
      await assert.rejects(
        issuer.registration.reoffer(accounts[1], { credential_id: offer.credential_id }),
        (error) => (error as any).body.reason === 'NotYours',
      );
      await assert.rejects(
        issuer.registration.register(accounts[2], {
          holder_reference: 'ref',
          claims: { certificateNumber: 'x' },
        }),
        (error) => (error as any).body.reason === 'NotATI',
      );
      const duplicate = {
        holder_reference: 'ref',
        claims: { certificateNumber: 'RACE-NUMBER', holderName: 'Ada' },
      };
      const race = await Promise.allSettled([register(duplicate), register(duplicate)]);
      assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(
        (race.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason.body
          .reason,
        'CertificateNumberTaken',
      );
      await database.query(
        'UPDATE accredited_organizations SET accredited_until=now() WHERE id=$1',
        [organizations[2]],
      );
      await assert.rejects(
        register(),
        (error) => (error as any).body.reason === 'AccreditationExpired',
      );
      assert.ok(
        await issuer.registration.reoffer(accounts[0], { credential_id: offer.credential_id }),
      );
      await database.query(
        "UPDATE accredited_organizations SET accredited_until=now()+interval '1 year' WHERE id=$1",
        [organizations[2]],
      );
      const priorOffer = await register();
      await database.query('UPDATE certificate_schemas SET retired_at=now() WHERE id=$1', [
        fixture.schema,
      ]);
      await assert.rejects(
        register(),
        (error) => (error as any).body.reason === 'SchemaNotAccredited',
      );
      assert.ok(
        (await issuer.metadata()).credential_configurations_supported[type],
        'Retirement retains the published issuance flow.',
      );
      const priorGrant = (await exchange(priorOffer)).body;
      assert.equal(
        (await issuer.redemption.redeem(priorGrant.access_token, await request(priorGrant))).status,
        200,
      );
      await database.query('UPDATE certificate_schemas SET retired_at=NULL WHERE id=$1', [
        fixture.schema,
      ]);
    },
  );

  await context.test(
    'HTTP aliases and existing refusal payloads remain usable by both consumers',
    async () => {
      const tokens = operatorTokens('stage-three-test-session-secret-only');
      const server = backOfficeServer({ accounts: postgresAccounts(database), tokens, issuer });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const local = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
      try {
        const bearer = (await tokens.pair({ id: accounts[0] })).access;
        const refused = await fetch(local + '/registry/issue/', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + bearer },
          body: JSON.stringify({ holder_reference: '', claims: {} }),
        });
        assert.equal(refused.status, 400);
        assert.deepEqual(Object.keys(await refused.json()).sort(), ['claims', 'holder_reference']);
        const metadata = await (
          await fetch(local + '/.well-known/openid-credential-issuer')
        ).json();
        assert.ok(metadata.credential_endpoint);
        // OpenID4VCI 1.0: the Nonce Endpoint answers a POST with a fresh c_nonce, never cached.
        const nonced = await fetch(new URL(metadata.nonce_endpoint).pathname.replace(/^/, local), {
          method: 'POST',
        });
        assert.equal(nonced.status, 200);
        assert.equal(nonced.headers.get('cache-control'), 'no-store');
        assert.match((await nonced.json()).c_nonce, /^[A-Za-z0-9_-]{43}$/);
        assert.equal((await fetch(local + '/auth/.well-known/openid-configuration')).status, 200);
        const grant = (await exchange(await register())).body;
        const response = await fetch(local + '/credentials/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + grant.access_token,
          },
          body: JSON.stringify(await request(grant)),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  await context.test(
    'reoffer waiting for finalization cannot reopen an already collected certificate',
    async () => {
      const offer = await register();
      const grant = (await exchange(offer)).body;
      let release!: () => void;
      let entered!: () => void;
      const signing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.gate = async () => {
        entered();
        await hold;
      };
      const collecting = issuer.redemption.redeem(grant.access_token, await request(grant));
      await signing;
      const replacing = issuer.registration
        .reoffer(accounts[0], { credential_id: offer.credential_id })
        .then(
          () => 'unexpected-success',
          (error) => error.body.reason,
        );
      try {
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = Boolean(
            (
              await database.query(
                "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%credential_tokens%' AND pid<>pg_backend_pid() ",
              )
            ).rowCount,
          );
          if (blocked) break;
          await setTimeout(10);
        }
        assert.ok(blocked, 'The replacement must wait for the held collection token lock.');
      } finally {
        release();
        state.gate = undefined;
      }
      assert.equal((await collecting).status, 200);
      assert.equal(await replacing, 'OfferAlreadyRedeemed');
    },
  );

  await context.test(
    'configured PIN digits and no-PIN deployments work through registration and token exchange',
    async () => {
      for (const policy of [{ pinDigits: 8, ttlMinutes: 3 }, { requirePin: false }]) {
        const protection = issuanceProtection(Buffer.alloc(32, 73), policy);
        const registration = postgresCertificateRegistration(database, {
          publicOrigin: origin,
          protection,
          ensureAccredited: trust.ensureAccredited,
          schemaAddress: fixture.schemas.address,
        });
        const offer = await registration.register(accounts[0], {
          holder_reference: 'ref',
          claims: { certificateNumber: 'CONFIG-' + ++counter, holderName: 'Ada' },
        });
        const resolved = await registration.offer(code(offer));
        // OpenID4VCI 1.0: a transaction code is asked for when the offer has a PIN.
        assert.equal(
          Boolean(resolved?.grants[preAuthorizedGrant].tx_code),
          policy.requirePin !== false,
        );
        const tokens = postgresCredentialTokenExchange(database, protection, {
          issuer: origin,
          signing: fixture.authorization,
        });
        assert.equal(
          (
            await tokens.exchange({
              grant_type: preAuthorizedGrant,
              'pre-authorized_code': code(offer),
              tx_code: offer.pin,
            })
          ).status,
          200,
        );
      }
    },
  );

  await context.test(
    'publication after offer creation changes the schema used at collection',
    async () => {
      const offer = await register();
      const grant = (await exchange(offer)).body;
      const next = fixture.tsr + 'Next';
      const original = await fixture.schemas.document(fixture.schemas.address(fixture.tsr));
      // The Support Office registers the next version in the TSR.
      assert.equal(
        (
          await mockFixture(fixture.base, '/__mock/support-office/schemas', {
            schemaId: next,
            schema: original,
          })
        ).registered,
        true,
      );
      await database.query(
        'INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) SELECT schema_id,2,fields,$2,clock_timestamp() FROM certificate_schema_versions WHERE schema_id=$1 AND version=1',
        [fixture.schema, next],
      );
      await fixture.onboarding.refresh(organizations[2]);
      try {
        const result = await issuer.redemption.redeem(grant.access_token, await request(grant));
        assert.equal(result.status, 200);
        const payload = JSON.parse(
          Buffer.from(result.body.credentials![0].credential.split('.')[1], 'base64url').toString(),
        );
        assert.equal(payload.vc.credentialSchema[0].id, fixture.schemas.address(next));
      } finally {
        await database.query(
          'DELETE FROM certificate_schema_versions WHERE schema_id=$1 AND version=2',
          [fixture.schema],
        );
        await fixture.onboarding.refresh(organizations[2]);
      }
    },
  );

  await context.test(
    'an unconfirmed draft cannot replace the published schema chosen for issuance',
    async () => {
      await database.query(
        "INSERT INTO certificate_schema_versions(schema_id,version,fields) VALUES($1,2,'[]')",
        [fixture.schema],
      );
      const offer = await register();
      assert.equal(
        (
          await database.query('SELECT schema_version FROM registered_certificates WHERE id=$1', [
            offer.certificate_id,
          ])
        ).rows[0].schema_version,
        1,
      );
      await database.query(
        'DELETE FROM certificate_schema_versions WHERE schema_id=$1 AND version=2',
        [fixture.schema],
      );
    },
  );

  await context.test('branch revocation between exchange and proof blocks collection', async () => {
    const offer = await register();
    const grant = (await exchange(offer)).body;
    const calls = state.signCalls;
    // The TAO revokes the TI's accreditation in the Trusted Issuers Registry.
    const {
      rows: [ti],
    } = await database.query(
      'SELECT parent_id,tir_attribute_id FROM accredited_organizations WHERE did=$1',
      [offer.issuer_did],
    );
    await fixture.ebsi.publisher!.revoke(
      await fixture.ebsi.actor(ti.parent_id),
      offer.issuer_did,
      ti.tir_attribute_id,
    );
    await assert.rejects(register(), (error) => (error as any).body.reason === 'NotAccredited');
    await assert.rejects(
      issuer.redemption.redeem(grant.access_token, await request(grant)),
      (error) => (error as any).body.reason === 'NotAccredited',
    );
    await database.query(
      "UPDATE accredited_organizations SET revoked_at=now(),revocation_reason='breach' WHERE id=$1",
      [organizations[1]],
    );
    assert.equal(
      (await issuer.redemption.redeem(grant.access_token, await request(grant))).status,
      401,
    );
    assert.equal(state.signCalls, calls);
  });
});

test('offer settings retain optional PIN, configured digits and lifetime', () => {
  const protection = issuanceProtection(Buffer.alloc(32, 2), { pinDigits: 8, ttlMinutes: 3 });
  const offer = protection.newOffer();
  assert.match(offer.pin!, /^\d{8}$/);
  assert.ok(+offer.expiresAt - Date.now() <= 180000);
  assert.ok(protection.matchesPin(offer.code, offer.pin!, offer.pinDigest));
  const without = issuanceProtection(Buffer.alloc(32, 2), { requirePin: false }).newOffer();
  assert.equal(without.pin, null);
  assert.equal(without.pinDigest.length, 0);
});
