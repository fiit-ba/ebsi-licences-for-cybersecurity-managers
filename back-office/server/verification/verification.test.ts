import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { decodeJwt, SignJWT } from 'jose';
import { backOfficeServer } from '../http/app.ts';
import { verificationFixture } from './fixtures/runtime.ts';
import { actualHolderWallet } from './fixtures/holder-wallet.ts';
import { parseExchangeInvitation, exchangeFields } from './exchange.ts';
import { verificationHttp } from './http.ts';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { credentialEvaluator } from './evaluate.ts';
import { verificationRegistry } from './registry.ts';
import type { AddressInfo } from 'node:net';

test('verification contracts with real HTTP, PostgreSQL, Redis and development DID/TIR/TSR', async (context) => {
  const fixture = await verificationFixture('https://verifier.example');
  context.after(() => fixture.close());
  const { database, service, accounts, access } = fixture;
  const server = backOfficeServer({
    accounts: fixture.accountStore,
    tokens: fixture.tokens,
    verification: fixture.verification,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const wallet = await actualHolderWallet();
  context.after(() => wallet.close());
  const credential = await fixture.credential();

  const request = async (
    path: string,
    method = 'GET',
    data?: unknown,
    authorization = 'Bearer ' + access[0],
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(authorization ? { authorization } : {}),
        'content-type': 'application/json',
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const offer = async () => {
    const created = await request('/registry/presentation-offer/');
    assert.equal(created.status, 200);
    const uri = new URL(new URL(created.body.offer_uri).searchParams.get('request_uri')!);
    const object = await fetch(origin + uri.pathname + uri.search);
    assert.equal(object.status, 200);
    // RFC 9101: the request object itself, typed oauth-authz-req+jwt.
    assert.equal(object.headers.get('content-type'), 'application/oauth-authz-req+jwt');
    const jwt = decodeJwt(await object.text());
    // OpenID4VP 1.0: the request asks with a DCQL query; the answer names its query id.
    const queryId = (jwt.dcql_query as any).credentials[0].id as string;
    return { ...created.body, jwt, queryId };
  };
  const submit = async (created: any, token: string) =>
    fetch(origin + '/auth/direct_post', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        state: created.state,
        vp_token: JSON.stringify({ [created.queryId]: [token] }),
      }),
    });
  const poll = (state: string, authorization?: string) =>
    request('/registry/presentation-result/?state=' + state, 'GET', undefined, authorization);

  await context.test(
    'flow URI, request exp in seconds, holder binding and complete evidence',
    async () => {
      const created = await offer();
      // A JWT NumericDate: seconds, ten minutes ahead.
      assert.ok(created.jwt.exp! > Date.now() / 1000 + 590);
      assert.ok(created.jwt.exp! < Date.now() / 1000 + 610);
      assert.equal(created.jwt.aud, 'https://self-issued.me/v2');
      assert.equal((await poll(created.state)).body.status, 'pending');
      const vp = await fixture.presentation(created.jwt, [credential.token]);
      assert.equal((await submit(created, vp)).status, 200);
      const result = (await poll(created.state)).body;
      assert.equal(result.outcome, 'VALID');
      assert.equal(result.verified, true);
      assert.equal(result.credentials[0].scope, 'presentation');
      assert.equal(result.credentials[0].key_id, fixture.oldKid);
      assert.equal(result.credentials[0].trust_chain.length, 4);
      assert.deepEqual(result.credentials[0].schemas, [fixture.schemaUrl]);
      assert.equal(result.credentials[0].ledger.standing, 'valid');
      assert.equal(result.credentials[0].attributes.holderName, 'Ada Lovelace');
      assert.ok(Object.values(result.checks).every((value) => value === true));
      const stored = (
        await database.query('SELECT * FROM presentation_results WHERE state=$1', [created.state])
      ).rows[0];
      assert.ok(stored.attributes_encrypted);
      assert.ok(!JSON.stringify(stored.evidence).includes('Ada Lovelace'));
      assert.ok(!JSON.stringify(stored.evidence).includes(fixture.holder.did));
      assert.ok(!stored.attributes_encrypted.includes(Buffer.from('Ada Lovelace')));
    },
  );

  await context.test(
    'a holder who declines (access_denied) ends the request at once, as its one answer',
    async () => {
      const decline = (fields: Record<string, string>) =>
        fetch(origin + '/auth/direct_post', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields),
        });
      const created = await offer();
      // Only the refusal the wallet sends, for the request's state, never beside a vp_token.
      assert.equal((await decline({ state: created.state, error: 'invalid_request' })).status, 400);
      assert.equal(
        (await decline({ state: created.state, error: 'access_denied', vp_token: '{}' })).status,
        400,
      );
      assert.equal((await decline({ error: 'access_denied' })).status, 400);
      assert.equal((await decline({ state: 'x'.repeat(43), error: 'access_denied' })).status, 400);
      assert.equal((await poll(created.state)).body.status, 'pending');

      assert.equal((await decline({ state: created.state, error: 'access_denied' })).status, 200);
      assert.equal((await poll(created.state)).body.status, 'declined');
      // Final: no second decline, no presentation after it, and the request object is spent.
      assert.equal((await decline({ state: created.state, error: 'access_denied' })).status, 400);
      const vp = await fixture.presentation(created.jwt, [credential.token]);
      assert.equal((await submit(created, vp)).status, 400);
      assert.equal((await poll(created.state)).body.status, 'declined');

      // A request no wallet has read (its request object never fetched) cannot be declined.
      const unread = await request('/registry/presentation-offer/');
      assert.equal(
        (await decline({ state: unread.body.state, error: 'access_denied' })).status,
        400,
      );
      assert.equal((await poll(unread.body.state)).body.status, 'pending');
    },
  );

  await context.test(
    'foreign operator requests/results, live verifier roles and foreign nonce/state',
    async () => {
      const created = await offer();
      assert.equal((await poll(created.state, 'Bearer ' + access[1])).status, 404);
      assert.equal((await poll(created.state, 'Bearer ' + access[2])).status, 403);
      const other = await offer();
      const wrongState = await fixture.presentation(created.jwt, [credential.token], {
        state: other.state,
      });
      assert.equal((await submit(other, wrongState)).status, 400);
      assert.equal((await poll(other.state)).body.status, 'pending');
      await database.query(
        "DELETE FROM operator_roles WHERE account_id=$1 AND role='plr_verifier'",
        [accounts[1]],
      );
      assert.equal((await poll(created.state, 'Bearer ' + access[1])).status, 403);
      await database.query("INSERT INTO operator_roles VALUES($1,'plr_verifier')", [accounts[1]]);
    },
  );

  await context.test(
    'wrong signature/holder/nonce/audience and expired presentations are refused without exposing attributes',
    async () => {
      for (const mode of ['signature', 'holder', 'nonce', 'audience', 'expiry']) {
        const created = await offer();
        let vp = await fixture.presentation(
          created.jwt,
          [credential.token],
          mode === 'nonce'
            ? { nonce: 'wrong' }
            : mode === 'audience'
              ? { aud: 'https://wrong.example' }
              : mode === 'expiry'
                ? { exp: Math.floor(Date.now() / 1000) - 10 }
                : {},
          mode === 'holder' ? fixture.otherHolder : fixture.holder,
        );
        if (mode === 'signature') {
          const parts = vp.split('.');
          const raw = Buffer.from(parts[2], 'base64url');
          raw[0] ^= 1;
          parts[2] = raw.toString('base64url');
          vp = parts.join('.');
        }
        assert.equal((await submit(created, vp)).status, 400, mode);
        // An unknown nonce cannot identify/complete a request. Every other
        // failed envelope with a known nonce has a retained refusal.
        const result = (await poll(created.state)).body;
        if (mode === 'nonce') assert.equal(result.status, 'pending');
        else {
          assert.equal(result.verified, false, mode);
          assert.equal(result.outcome, 'INDETERMINATE', mode);
          assert.ok(
            result.credentials.every((item: any) => item.attributes === null),
            mode,
          );
        }
      }
    },
  );

  await context.test(
    'API keys, revoked keys, request scopes and direct credential scope',
    async () => {
      const path = '/verifier/v1/credentials/verify/';
      for (const auth of ['', 'Bearer ' + access[0], 'ApiKey plr_rp_wrong'])
        assert.equal(
          (await request(path, 'POST', { credential: credential.token }, auth)).status,
          401,
        );
      const key = 'ApiKey ' + fixture.firstParty.key;
      const result = await request(path, 'POST', { credential: credential.token }, key);
      assert.equal(result.status, 200);
      assert.equal(result.body.state, 'VALID');
      assert.equal(result.body.scope, 'credential');
      assert.equal(result.body.checks.presentation_valid, null);
      assert.equal(result.body.checks.holder_bound, null);
      assert.equal((await request(path, 'POST', { credential: 'broken' }, key)).status, 400);
      assert.equal(
        (await request('/verifier/v1/presentation-requests/', 'POST', { scope: 'missing' }, key))
          .status,
        404,
      );
      const created = await request('/verifier/v1/presentation-requests/', 'POST', {}, key);
      assert.equal(created.status, 201);
      assert.equal(
        (
          await request(
            '/verifier/v1/presentation-requests/' + created.body.state + '/',
            'GET',
            undefined,
            'ApiKey ' + fixture.secondParty.key,
          )
        ).status,
        404,
      );
      const revoked = await fixture.parties.create('revoked-' + fixture.firstParty.party.id);
      await fixture.parties.revoke(revoked.party.name);
      assert.equal(
        (await request(path, 'POST', { credential: credential.token }, 'ApiKey ' + revoked.key))
          .status,
        401,
      );
      await database.query('DELETE FROM relying_parties WHERE id=$1', [revoked.party.id]);
    },
  );

  await context.test(
    'mobile read bearer is independent of QR state, and request expiry is preserved',
    async () => {
      const created = await request('/verifier/v1/mobile/presentation-requests/', 'POST', {}, '');
      assert.equal(created.status, 201);
      assert.match(created.body.qr, /^data:image\/png;base64,/);
      const path = '/verifier/v1/mobile/presentation-requests/' + created.body.state + '/';
      assert.equal((await request(path, 'GET', undefined, '')).status, 404);
      assert.equal(
        (await request(path, 'GET', undefined, '', { 'X-PLR-Read-Token': 'wrong' })).status,
        404,
      );
      assert.equal(
        (await request(path, 'GET', undefined, '', { 'X-PLR-Read-Token': created.body.read_token }))
          .body.status,
        'pending',
      );
      assert.equal(
        (
          await request(
            '/verifier/v1/presentation-requests/' + created.body.state + '/',
            'GET',
            undefined,
            'ApiKey ' + fixture.firstParty.key,
          )
        ).status,
        404,
      );
      await database.query(
        "UPDATE presentation_requests SET expires_at=now()-interval '1 second' WHERE state=$1",
        [created.body.state],
      );
      assert.equal(
        (await request(path, 'GET', undefined, '', { 'X-PLR-Read-Token': created.body.read_token }))
          .body.status,
        'expired',
      );
      await database.query('DELETE FROM presentation_requests WHERE state=$1', [
        created.body.state,
      ]);
    },
  );

  await context.test(
    'altered, repeated, missing and unrecognized disclosure material produces the expected verdicts',
    async () => {
      const direct = (token: string) => service.verifyCredential(token);
      assert.equal((await direct(credential.jwt + '~')).state, 'VALID');
      assert.equal((await direct(credential.jwt)).state, 'VALID');
      assert.equal(
        (
          await direct(
            credential.jwt +
              '~' +
              credential.disclosures[0] +
              '~' +
              credential.disclosures[0] +
              '~',
          )
        ).state,
        'INVALID_SIGNATURE',
      );
      const altered = Buffer.from(JSON.stringify(['salt', 'holderName', 'Changed'])).toString(
        'base64url',
      );
      assert.equal(
        (await direct(credential.jwt + '~' + altered + '~')).checks.disclosures_valid,
        false,
      );
      assert.equal((await direct(credential.token + 'key.binding.jwt')).state, 'INVALID_SIGNATURE');
      const parts = credential.jwt.split('.');
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      decoded.vc.id = 'tampered';
      parts[1] = Buffer.from(JSON.stringify(decoded)).toString('base64url');
      assert.equal((await direct(parts.join('.'))).state, 'INVALID_SIGNATURE');
    },
  );

  await context.test(
    'status outages, missing records, exact tuple mismatch and suspended/revoked evidence remain distinct',
    async () => {
      const disabled = await credentialEvaluator({ registry: fixture.registryReader })(
        credential.token,
      );
      assert.equal(disabled.state, 'STATUS_UNAVAILABLE');
      assert.equal(disabled.reason, 'No certificate registry is configured here');
      assert.equal(disabled.checks.status_available, false);
      for (const [standing, expected] of [
        ['2', 'SUSPENDED'],
        ['3', 'REVOKED'],
        ['0', 'STATUS_UNAVAILABLE'],
      ]) {
        await database.query(
          `UPDATE ${fixture.table} SET record=jsonb_set(record,'{standing}',to_jsonb($2::text)) WHERE key=$1`,
          [credential.key, standing],
        );
        const result = await service.verifyCredential(credential.token);
        assert.equal(result.state, expected);
        assert.ok(result.attributes.holderName);
        assert.equal(
          result.ledger!.standing,
          standing === '2' ? 'suspended' : standing === '3' ? 'revoked' : 'none',
        );
      }
      await database.query(`UPDATE ${fixture.table} SET record=$2,mode='outage' WHERE key=$1`, [
        credential.key,
        credential.record,
      ]);
      const outage = await service.verifyCredential(credential.token);
      assert.equal(outage.state, 'STATUS_UNAVAILABLE');
      assert.equal(outage.checks.status_available, false);
      // A record that is not this credential's: another credential's hash under its key.
      await database.query(
        `UPDATE ${fixture.table} SET mode='',record=jsonb_set(record,'{credentialHash}',to_jsonb($2::text)) WHERE key=$1`,
        [credential.key, '0x' + '42'.repeat(32)],
      );
      const mismatch = await service.verifyCredential(credential.token);
      assert.equal(mismatch.state, 'INDETERMINATE');
      assert.equal(mismatch.checks.record_matches, false);
      await database.query(`UPDATE ${fixture.table} SET record=$2 WHERE key=$1`, [
        credential.key,
        credential.record,
      ]);
      assert.equal((await service.verifyCredential(credential.token)).state, 'VALID');
    },
  );

  await context.test(
    'DID/TIR/TSR unavailability is indeterminate and recovers without widening trust',
    async () => {
      for (const part of ['/v1/did-registry', '/v1/issuers-registry', '/v1/schemas-registry']) {
        fixture.state.registryDown = part;
        const result = await service.verifyCredential(credential.token);
        assert.equal(result.state, 'INDETERMINATE', part);
        fixture.state.registryDown = '';
        assert.equal((await service.verifyCredential(credential.token)).state, 'VALID');
      }
      const wrongSchema = await fixture.credential({
        credentialSchema: [
          { id: fixture.schemaUrl + 'missing', type: 'FullJsonSchemaValidator2021' },
        ],
      });
      assert.equal((await service.verifyCredential(wrongSchema.token)).state, 'UNTRUSTED_ISSUER');
      const schemaMismatch = await fixture.credential(
        { credentialSubject: { id: fixture.holder.did, certificateNumber: 'WRONG' } },
        false,
      );
      assert.equal(
        (await service.verifyCredential(schemaMismatch.token)).checks.schemas_valid,
        false,
      );
    },
  );

  await context.test(
    'historical schema and rotated issuer key verify at issuance; retired keys cannot sign new credentials',
    async () => {
      const result = await service.verifyCredential(credential.token);
      assert.equal(result.state, 'VALID');
      assert.equal(result.key_id, fixture.oldKid);
      assert.ok(
        fixture.state.reads.some(
          (url) => url.includes('valid-at=') && url.includes('did-registry'),
        ),
      );
      const newlySignedByRetired = await fixture.credential({
        issuanceDate: new Date().toISOString(),
      });
      assert.equal(
        (await service.verifyCredential(newlySignedByRetired.token)).state,
        'INVALID_SIGNATURE',
      );
      const expired = await fixture.credential({
        validUntil: new Date(Date.now() - 1000).toISOString(),
      });
      assert.equal((await service.verifyCredential(expired.token)).state, 'EXPIRED');
      const future = await fixture.credential({
        validFrom: new Date(Date.now() + 120_000).toISOString(),
      });
      assert.equal((await service.verifyCredential(future.token)).state, 'NOT_YET_VALID');
    },
  );

  await context.test(
    'recorded certification-body validity is evaluated at issuance, with immediate ancestor revocation',
    async () => {
      const [root, tao, ti, schema, certificate] = Array.from({ length: 5 }, () => randomUUID());
      try {
        await database.query(
          "INSERT INTO accredited_organizations(id,name,kind) VALUES($1,'Verification Root','rtao')",
          [root],
        );
        await database.query(
          "INSERT INTO accredited_organizations(id,name,kind,parent_id) VALUES($1,'Verification TAO','tao',$2)",
          [tao, root],
        );
        await database.query(
          "INSERT INTO accredited_organizations(id,name,kind,parent_id,did,accredited_until) VALUES($1,'Historical TI','ti',$2,$3,now()-interval '1 day')",
          [ti, tao, fixture.did],
        );
        await database.query(
          "INSERT INTO certificate_schemas(id,credential_type,name_sk,retired_at) VALUES($1,$2,'Historical schema',now())",
          [schema, 'Verification' + schema.replaceAll('-', '')],
        );
        await database.query(
          "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,1,'[]',$2,now())",
          [schema, fixture.schemaUrl.split('/').at(-1)],
        );
        await database.query(
          `INSERT INTO registered_certificates(id,credential_id,issuer_id,issuer_did,issuer_accredited_until,schema_id,schema_version,certificate_number,status_key,credential_hash,private_data,created_at,created_by)
        VALUES($1,$2,$3,$4,now()-interval '5 days',$5,1,$6,$7,$8,$9,now()-interval '10 days',$10)`,
          [
            certificate,
            credential.vc.id,
            ti,
            fixture.did,
            schema,
            credential.vc.credentialSubject.certificateNumber,
            Buffer.from(credential.key.slice(2), 'hex'),
            Buffer.from(credential.record.credentialHash.slice(2), 'hex'),
            Buffer.alloc(32),
            accounts[0],
          ],
        );
        const historical = await service.verifyCredential(credential.token);
        assert.equal(historical.state, 'VALID');
        assert.equal(historical.certification_body!.accredited_at_issuance, true);
        assert.equal(historical.certification_body!.in_force_now, false);
        await database.query(
          "UPDATE registered_certificates SET issuer_accredited_until=created_at-interval '1 second' WHERE id=$1",
          [certificate],
        );
        assert.equal((await service.verifyCredential(credential.token)).state, 'UNTRUSTED_ISSUER');
        await database.query(
          "UPDATE registered_certificates SET issuer_accredited_until=created_at+interval '5 days' WHERE id=$1",
          [certificate],
        );
        await database.query(
          "UPDATE accredited_organizations SET revoked_at=now()-interval '1 second',revocation_reason='ceased' WHERE id=$1",
          [tao],
        );
        const revoked = await service.verifyCredential(credential.token);
        assert.equal(revoked.state, 'REVOKED');
        assert.equal(revoked.certification_body!.revoked_organization, 'Verification TAO');
      } finally {
        await database.query('DELETE FROM registered_certificates WHERE id=$1', [certificate]);
        await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [
          schema,
        ]);
        await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
        for (const id of [ti, tao, root])
          await database.query('DELETE FROM accredited_organizations WHERE id=$1', [id]);
      }
    },
  );

  await context.test(
    'concurrent submits, repeated callbacks and lost HTTP responses preserve one result',
    async () => {
      const created = await offer();
      const vp = await fixture.presentation(created.jwt, [credential.token]);
      const statuses = await Promise.all(
        Array.from({ length: 16 }, async () => (await submit(created, vp)).status),
      );
      assert.equal(statuses.filter((status) => status === 200).length, 1);
      assert.equal((await poll(created.state)).body.outcome, 'VALID');
      const before = (
        await database.query('SELECT id,created_at FROM presentation_results WHERE state=$1', [
          created.state,
        ])
      ).rows;
      assert.equal((await submit(created, vp)).status, 400);
      assert.deepEqual(
        (
          await database.query('SELECT id,created_at FROM presentation_results WHERE state=$1', [
            created.state,
          ])
        ).rows,
        before,
      );
      const lost = await offer();
      const response = await submit(lost, await fixture.presentation(lost.jwt, [credential.token]));
      await response.body?.cancel();
      assert.equal((await poll(lost.state)).body.outcome, 'VALID');
    },
  );

  await context.test(
    'attribute deadlines hide data before purge; physical purge preserves evidence',
    async () => {
      const created = await offer();
      assert.equal(
        (await submit(created, await fixture.presentation(created.jwt, [credential.token]))).status,
        200,
      );
      await database.query(
        'UPDATE presentation_results SET attributes_until=now() WHERE state=$1',
        [created.state],
      );
      const result = (await poll(created.state)).body;
      assert.equal(result.credentials[0].attributes, null);
      assert.equal(result.attributes_until, null);
      assert.ok((await service.purgeAttributes())! >= 1);
      const stored = (
        await database.query('SELECT * FROM presentation_results WHERE state=$1', [created.state])
      ).rows[0];
      assert.equal(stored.attributes_encrypted, null);
      assert.equal(stored.evidence[0].issuer, fixture.did);
    },
  );

  await context.test(
    'callback database failure rolls back result and nonce consumption together',
    async () => {
      const created = await offer();
      const vp = await fixture.presentation(created.jwt, [credential.token]);
      await database.query(`CREATE FUNCTION verification_fixture_reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state='${created.state}' THEN RAISE EXCEPTION 'Injected fixture insert failure'; END IF; RETURN NEW; END $$`);
      await database.query(
        'CREATE TRIGGER verification_fixture_reject BEFORE INSERT ON presentation_results FOR EACH ROW EXECUTE FUNCTION verification_fixture_reject_result()',
      );
      try {
        assert.equal((await submit(created, vp)).status, 503);
        assert.equal(
          (
            await database.query('SELECT 1 FROM presentation_results WHERE state=$1', [
              created.state,
            ])
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await database.query('SELECT consumed_at FROM presentation_challenges WHERE nonce=$1', [
              created.jwt.nonce,
            ])
          ).rows[0].consumed_at,
          null,
        );
      } finally {
        await database.query('DROP TRIGGER verification_fixture_reject ON presentation_results');
        await database.query('DROP FUNCTION verification_fixture_reject_result()');
      }
      assert.equal((await submit(created, vp)).status, 200);
      assert.equal((await poll(created.state)).body.outcome, 'VALID');
    },
  );

  await context.test(
    'actual Wallet holder exchange, concurrent polls and completed-response loss',
    async () => {
      const holderExchange = wallet.create();
      const created = await service.exchange.start(
        holderExchange.invitation,
        { operator: accounts[0] },
        'Test verifier',
      );
      assert.equal(
        (await service.read(created.state, { operator: accounts[0] })).status,
        'pending',
      );
      const vp = await fixture.presentation(holderExchange.query, [credential.token]);
      holderExchange.answer({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: 'EnvelopedVerifiablePresentation',
        id: 'data:application/jwt,' + vp,
      });
      const progress = await Promise.all(
        Array.from({ length: 12 }, () => service.read(created.state, { operator: accounts[0] })),
      );
      assert.ok(progress.some((item) => 'outcome' in item && item.outcome === 'VALID'));
      assert.equal((await poll(created.state)).body.outcome, 'VALID');
      assert.equal(holderExchange.state, 'closed');
      assert.equal((await poll(created.state)).body.outcome, 'VALID');
    },
  );

  await context.test(
    'holder decline, expiration, missing mandatory fields and invitation restrictions',
    async () => {
      for (const mode of ['declined', 'expired', 'mandatory']) {
        const holderExchange = wallet.create();
        const created = await service.exchange.start(
          holderExchange.invitation,
          { operator: accounts[0] },
          'Test verifier',
        );
        if (mode === 'declined') holderExchange.decline();
        if (mode === 'expired') holderExchange.close();
        if (mode === 'mandatory') {
          const vp = await fixture.presentation(holderExchange.query, [credential.jwt]);
          holderExchange.answer({
            type: 'EnvelopedVerifiablePresentation',
            id: 'data:application/jwt,' + vp,
          });
        }
        const result = await service.read(created.state, { operator: accounts[0] });
        assert.equal(
          mode === 'mandatory' && 'outcome' in result ? result.outcome : result.status,
          mode === 'mandatory' ? 'INDETERMINATE' : mode,
        );
      }
      const holderExchange = wallet.create();
      assert.throws(() => parseExchangeInvitation(holderExchange.invitation, '10.0.0.0/8'), {
        reason: 'not_allowed',
      });
      for (const url of [
        'http://localhost:9000/exchanges/abcdefghijklmnop',
        'http://127.1:9000/exchanges/abcdefghijklmnop',
        'http://2130706433:9000/exchanges/abcdefghijklmnop',
        'http://127.0.0.1:80/exchanges/abcdefghijklmnop',
        'http://127.0.0.1:9000/elsewhere',
        'https://127.0.0.1:9000/exchanges/abcdefghijklmnop',
      ])
        assert.throws(() =>
          parseExchangeInvitation({ ...holderExchange.invitation, url }, '127.0.0.0/8'),
        );
      assert.deepEqual(
        exchangeFields({
          mandatory: ['holderName', 'holderName'],
          optional: ['holderName', 'jobPosition'],
        }),
        { mandatory: ['holderName'], optional: ['jobPosition'] },
      );
    },
  );

  await context.test(
    'a one-shot Wallet answer survives result persistence failure within the existing cache TTL',
    async () => {
      const holderExchange = wallet.create();
      const created = await service.exchange.start(
        holderExchange.invitation,
        { operator: accounts[0] },
        'Test verifier',
      );
      holderExchange.answer({
        type: 'EnvelopedVerifiablePresentation',
        id:
          'data:application/jwt,' +
          (await fixture.presentation(holderExchange.query, [credential.token])),
      });
      await database.query(`CREATE FUNCTION verification_fixture_reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state='${created.state}' THEN RAISE EXCEPTION 'Injected fixture insert failure'; END IF; RETURN NEW; END $$`);
      await database.query(
        'CREATE TRIGGER verification_fixture_reject BEFORE INSERT ON presentation_results FOR EACH ROW EXECUTE FUNCTION verification_fixture_reject_result()',
      );
      try {
        await assert.rejects(service.read(created.state, { operator: accounts[0] }));
        assert.equal(holderExchange.state, 'closed');
      } finally {
        await database.query('DROP TRIGGER verification_fixture_reject ON presentation_results');
        await database.query('DROP FUNCTION verification_fixture_reject_result()');
      }
      const retried = await service.read(created.state, { operator: accounts[0] });
      assert.ok('outcome' in retried && retried.outcome === 'VALID');
    },
  );

  await context.test(
    'party/mobile admission limits remain atomic and mobile endpoints can be disabled',
    async () => {
      const party = await fixture.parties.create('limit-' + fixture.firstParty.party.id);
      const responses = await Promise.all(
        Array.from({ length: 130 }, () =>
          request(
            '/verifier/v1/credentials/verify/',
            'POST',
            { credential: 'malformed' },
            'ApiKey ' + party.key,
          ),
        ),
      );
      assert.equal(responses.filter((item) => item.status === 400).length, 120);
      assert.equal(responses.filter((item) => item.status === 429).length, 10);
      assert.ok(responses.find((item) => item.status === 429)!.headers.get('retry-after'));
      await database.query('DELETE FROM relying_parties WHERE id=$1', [party.party.id]);
      const mobile = await Promise.all(
        Array.from({ length: 25 }, () =>
          request('/verifier/v1/mobile/presentation-requests/', 'POST', {}, ''),
        ),
      );
      // One earlier mobile request consumed an admission in this fixture.
      assert.equal(mobile.filter((item) => item.status === 201).length, 19);
      assert.equal(mobile.filter((item) => item.status === 429).length, 6);
      const states = mobile.filter((item) => item.status === 201).map((item) => item.body.state);
      await database.query('DELETE FROM presentation_requests WHERE state=ANY($1::text[])', [
        states,
      ]);
      const disabled = backOfficeServer({
        accounts: fixture.accountStore,
        tokens: fixture.tokens,
        verification: {
          ...fixture.verification,
          publicHttp: verificationHttp(service, {
            parties: fixture.parties,
            partyThrottle: async () => null,
            mobileThrottle: async () => null,
            mobileEnabled: false,
          }),
        },
      });
      disabled.listen(0, '127.0.0.1');
      await once(disabled, 'listening');
      try {
        const reply = await fetch(
          'http://127.0.0.1:' +
            (disabled.address() as AddressInfo).port +
            '/verifier/v1/mobile/presentation-requests/',
          { method: 'POST' },
        );
        assert.equal(reply.status, 404);
      } finally {
        await new Promise<void>((resolve) => disabled.close(() => resolve()));
      }
    },
  );

  await context.test(
    'console and relying-party exchange HTTP routes preserve result ownership and projections',
    async () => {
      for (const party of [false, true]) {
        const source = wallet.create();
        const created = await request(
          party ? '/verifier/v1/exchanges/' : '/registry/presentation-exchange/',
          'POST',
          { invitation: source.invitation },
          party ? 'ApiKey ' + fixture.firstParty.key : 'Bearer ' + access[0],
        );
        assert.equal(created.status, 201);
        source.answer({
          type: 'EnvelopedVerifiablePresentation',
          id:
            'data:application/jwt,' +
            (await fixture.presentation(source.query, [credential.token])),
        });
        if (party) {
          const path = '/verifier/v1/presentation-requests/' + created.body.state + '/';
          assert.equal(
            (await request(path, 'GET', undefined, 'ApiKey ' + fixture.secondParty.key)).status,
            404,
          );
          const result = await request(path, 'GET', undefined, 'ApiKey ' + fixture.firstParty.key);
          assert.equal(result.body.result, 'VALID');
          assert.equal(result.body.acceptable, true);
        } else {
          assert.equal((await poll(created.body.state, 'Bearer ' + access[1])).status, 404);
          assert.equal((await poll(created.body.state)).body.outcome, 'VALID');
        }
      }
    },
  );

  await context.test(
    'ES256K issuer credentials verify without confusing another key type with EC',
    async () => {
      const pair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
      const publicJwk = pair.publicKey.export({ format: 'jwk' });
      const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
      let mode = 'ec';
      const base = process.env.BACK_OFFICE_TEST_EBSI_URL!;
      const registry = verificationRegistry({
        didr: base + '/v1/did-registry/identifiers',
        tir: base + '/v1/issuers-registry',
        tsr: base + '/v1/schemas-registry',
        roots: ['did:ebsi:zSupport'],
        didSeconds: 0,
        fetchRegistry: async (url, init) => {
          if (new URL(String(url)).pathname === '/v1/did-registry/identifiers/' + fixture.did)
            return Response.json({
              id: fixture.did,
              assertionMethod: [fixture.oldKid],
              verificationMethod: [
                {
                  id: fixture.oldKid,
                  controller: fixture.did,
                  publicKeyJwk:
                    mode === 'ec'
                      ? publicJwk
                      : { ...rsa.publicKey.export({ format: 'jwk' }), crv: 'secp256k1' },
                },
              ],
            });
          return fetch(url, init);
        },
      });
      const payload = decodeJwt(credential.jwt);
      const input =
        Buffer.from(JSON.stringify({ alg: 'ES256K', kid: fixture.oldKid })).toString('base64url') +
        '.' +
        Buffer.from(JSON.stringify(payload)).toString('base64url');
      const jwt =
        input +
        '.' +
        sign('sha256', Buffer.from(input), {
          key: pair.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url');
      const verifier = credentialEvaluator({ registry, ledger: fixture.ledger });
      // The record keeps the hash of the credential it was collected as: this one, for now.
      const record = (key: string, hash: string) =>
        database.query(
          `UPDATE ${fixture.table} SET record=jsonb_set(record,'{credentialHash}',to_jsonb($2::text)) WHERE key=$1`,
          [key, hash],
        );
      await record(credential.key, '0x' + createHash('sha256').update(jwt).digest('hex'));
      try {
        assert.equal(
          (await verifier(jwt + '~' + credential.disclosures.join('~') + '~')).state,
          'VALID',
        );
        mode = 'rsa';
        const forged =
          input + '.' + sign('sha256', Buffer.from(input), rsa.privateKey).toString('base64url');
        assert.equal((await verifier(forged)).state, 'INVALID_SIGNATURE');
      } finally {
        await record(credential.key, credential.record.credentialHash);
      }
    },
  );

  await context.test(
    'a callback resolves its current VerifyFlow rather than a frozen definition snapshot',
    async () => {
      const created = await offer();
      // The flow's DCQL query now names another credential query than the request did.
      const flow = (
        await database.query(
          "SELECT definition_id,dcql_query FROM presentation_definitions WHERE dcql_query->'credentials'->0->>'id'=$1",
          [created.queryId],
        )
      ).rows[0];
      const definition = flow.definition_id;
      const old = flow.dcql_query;
      try {
        const changed = structuredClone(old);
        changed.credentials[0].id = 'changed_source_query';
        await database.query(
          'UPDATE presentation_definitions SET dcql_query=$2 WHERE definition_id=$1',
          [definition, JSON.stringify(changed)],
        );
        assert.equal(
          (await submit(created, await fixture.presentation(created.jwt, [credential.token])))
            .status,
          400,
        );
        assert.equal((await poll(created.state)).body.outcome, 'INDETERMINATE');
      } finally {
        await database.query(
          'UPDATE presentation_definitions SET dcql_query=$2 WHERE definition_id=$1',
          [definition, JSON.stringify(old)],
        );
      }
    },
  );

  await context.test(
    'five consecutive connection failures retain the existing unreachable progress',
    async () => {
      const unreachableWallet = await actualHolderWallet();
      const holderExchange = unreachableWallet.create();
      const created = await service.exchange.start(
        holderExchange.invitation,
        { operator: accounts[0] },
        'Test verifier',
      );
      await unreachableWallet.close();
      for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await service.read(created.state, { operator: accounts[0] });
        assert.equal(result.status, attempt === 5 ? 'unreachable' : 'pending');
      }
      assert.equal(
        (await service.read(created.state, { operator: accounts[0] })).status,
        'unreachable',
      );
    },
  );
});
