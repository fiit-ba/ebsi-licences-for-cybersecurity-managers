import { postgresCertificateList } from '../lifecycle/certificates.ts';
import { postgresStandingRefresh } from '../lifecycle/standing.ts';
import { postgresIssuerRevocation } from '../verification/issuer-revocation.ts';
import { walletPresentationProfile } from '../verification/http-profile.ts';
import { postgresPresentationSessions } from '../verification/sessions.ts';
import { credentialVerifier } from '../verification/credential.ts';
import { presentationVerifier } from '../verification/presentation.ts';
import { KeyObject, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, importJWK, jwtVerify, SignJWT } from 'jose';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import pg from 'pg';
import { postgresTrustChain } from './chain.ts';
import { postgresInvitations } from './invitations.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { hashPassword } from '../identity/auth/passwords.ts';
import { createIssuer } from '../issuance/issuer.ts';
import { authorizationFixture } from '../issuance/fixtures/authorization.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { postgresCredentialRedemption } from '../issuance/redemption.ts';
import { postgresCredentialTokenExchange } from '../issuance/token-exchange.ts';
import {
  certificateStatusKey,
  issuanceProtection,
  preAuthorizedGrant,
  secretDigest,
} from '../issuance/protection.ts';
import { postgresCredentialNonces } from '../issuance/nonces.ts';
import { postgresCertificateRegistration } from '../issuance/registration.ts';
import { postgresIssuanceSchemes } from '../issuance/schemes.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';

async function holderKey() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const { crv, kty, x, y } = await exportJWK(publicKey);
  const encoded = Buffer.concat([
    Buffer.from([0xd1, 0xd6, 3]),
    Buffer.from(JSON.stringify({ crv, kty, x, y })),
  ]);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = BigInt('0x' + encoded.toString('hex'));
  let fingerprint = '';
  while (number) {
    fingerprint = alphabet[Number(number % 58n)] + fingerprint;
    number /= 58n;
  }
  const did = 'did:key:z' + fingerprint;
  return {
    did,
    async presentation(credentials, audience, nonce, state) {
      return new SignJWT({
        nonce,
        state,
        vp: { holder: did, type: ['VerifiablePresentation'], verifiableCredential: credentials },
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: did + '#z' + fingerprint })
        .setIssuer(did)
        .setSubject(did)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);
    },
    // An OpenID4VCI 1.0 jwt key proof; without iss, as access to the token endpoint was
    // anonymous (pre-authorized code).
    async proof(nonce, audience, expires = Math.floor(Date.now() / 1000) + 300) {
      return new SignJWT({ nonce })
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'openid4vci-proof+jwt',
          kid: did + '#z' + fingerprint,
        })
        .setAudience(audience)
        .setIssuedAt(Date.now() / 1000)
        .setExpirationTime(expires)
        .sign(privateKey);
    },
  };
}

test('accreditors delegate only their schemas and invitations are consumed once', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const initialGroupIds = (
    await database.query<{ id: number }>('SELECT id FROM operator_groups')
  ).rows.map((row) => row.id);
  const {
    rows: [account],
  } = await database.query(
    "INSERT INTO operator_accounts (username, password_hash) VALUES ('test-root', $1) RETURNING id",
    [await hashPassword('root-test-password')],
  );
  const {
    rows: [root],
  } = await database.query(
    `
    INSERT INTO accredited_organizations (name, kind, account_id)
    VALUES ('Test Root', 'rtao', $1) RETURNING id
  `,
    [account.id],
  );
  const organizations = [root.id];
  context.after(async () => {
    try {
      await database.query(
        'DELETE FROM accreditation_withdrawals WHERE revoked_organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await database.query(
        'DELETE FROM accreditation_events WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      for (const table of ['certificate_status_proposals', 'certificate_emergency_suspensions'])
        await database.query(
          `DELETE FROM ${table} WHERE certificate_id IN (SELECT id FROM registered_certificates WHERE issuer_id=ANY($1::uuid[]))`,
          [organizations],
        );
      await database.query(
        'DELETE FROM registered_certificates WHERE issuer_id = ANY($1::uuid[])',
        [organizations],
      );
      await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query(`
        DELETE FROM certificate_schema_versions WHERE schema_id IN (
          SELECT id FROM certificate_schemas WHERE credential_type IN ('InvitationTest', 'InvitationDraft')
        )
      `);
      await database.query(
        "DELETE FROM certificate_schemas WHERE credential_type IN ('InvitationTest', 'InvitationDraft')",
      );
      await database.query(
        "DELETE FROM operator_accounts WHERE username IN ('test-root', 'test-tao', 'test-ti', 'test-other-tao')",
      );
      await database.query(
        'DELETE FROM operator_groups WHERE NOT (id=ANY($1::integer[])) AND NOT EXISTS (SELECT 1 FROM operator_account_groups m WHERE m.group_id=operator_groups.id)',
        [initialGroupIds],
      );
    } finally {
      await database.end();
    }
  });
  await database.query("INSERT INTO operator_roles VALUES ($1, 'plr_rtao')", [account.id]);
  await database.query(
    "INSERT INTO certificate_schemas (credential_type, name_sk) VALUES ('InvitationTest', 'Test')",
  );

  const tokens = operatorTokens('test-only-secret-for-the-invitation-suite');
  const protection = issuanceProtection(Buffer.alloc(32, 123));
  const issuerOrigin = 'https://issuer.example';
  const { publicKey: issuerPublicKey, privateKey: issuerPrivateKey } = await generateKeyPair(
    'ES256',
    { extractable: true },
  );
  const ledgerRecords = [];
  const authorization = await authorizationFixture();
  const issuer = createIssuer(database, {
    authorization,
    protection,
    publicOrigin: issuerOrigin,
    ensureAccredited: async (did, type) => {
      assert.equal(did, 'did:ebsi:zTest');
      assert.equal(type, 'InvitationTest');
    },
    signingKey: async (did) => ({
      kid: did + '#test-key',
      sign: (input) =>
        sign('sha256', input, { key: KeyObject.from(issuerPrivateKey), dsaEncoding: 'ieee-p1363' }),
    }),
    ledger: {
      chainId: 1337,
      contract: '0x' + 'ab'.repeat(20),
      async ensureRegistered(record) {
        ledgerRecords.push(record);
      },
    },
    schemaAddress: (id) => 'https://tsr.example/schemas/' + id,
    ledgerStatusSchema: 'https://tsr.example/schemas/ledger-status',
    accreditationAddress: (did, attribute) =>
      `https://tir.example/issuers/${did}/attributes/${attribute}`,
  });
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    invitations: postgresInvitations(database),
    trustChain: postgresTrustChain(database),
    tokens,
    issuer,
    listCertificates: postgresCertificateList(database, protection),
    issuanceSchemes: postgresIssuanceSchemes(database),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path, body, token?: string) =>
    fetch(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const select = '/registry/trust-chain/select/';
  const renew = '/registry/trust-chain/invitation/';
  const read = (token) =>
    fetch(origin + '/registry/trust-chain/', {
      headers: { authorization: `Bearer ${token}` },
    });
  const register = '/organizations/v1/registrations/';
  const rootToken = (await tokens.pair({ id: account.id, username: 'test-root' })).access;
  assert.equal((await post(select, { name: 'Test TAO' })).status, 401);
  const tao = await post(select, { name: 'Test TAO', schemas: ['InvitationTest'] }, rootToken);
  assert.equal(tao.status, 201);
  const selected = await tao.json();
  organizations.push(selected.organization_id);
  assert.equal(selected.kind, 'tao');

  const signup = {
    invitation: selected.invitation,
    username: 'test-tao',
    password: 'tao-test-password',
  };
  const mismatch = await post(register, { ...signup, kind: 'ti' });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).reason, 'WrongKind');

  await context.test(
    'registration refuses short and predictable passwords without consuming the invitation',
    async () => {
      for (const [password, code] of [
        ['password', 'password_too_short'],
        ['test-taotest-taotest-tao', 'password_too_weak'],
        ['²'.repeat(20), 'password_too_weak'],
        ['🔐🔐🔐🔐', 'password_too_short'],
      ]) {
        const weak = await post(register, { ...signup, password });
        assert.equal(weak.status, 400);
        const refusal = await weak.json();
        assert.equal(refusal.reason, 'WeakPassword');
        assert.ok(refusal.codes.includes(code));
        const state = await database.query(
          'SELECT account_id, invitation_digest FROM accredited_organizations WHERE id = $1',
          [selected.organization_id],
        );
        assert.equal(state.rows[0].account_id, null);
        assert.ok(state.rows[0].invitation_digest);
      }
    },
  );

  const attempts = await Promise.all([post(register, signup), post(register, signup)]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 404]);

  const login = await post('/api/api-token-auth', signup);
  assert.equal(login.status, 200);
  const { access } = await login.json();
  const accredited_until = new Date(Date.now() + 86400000).toISOString();
  const refused = await post(
    select,
    { name: 'Test TI', schemas: ['Unknown'], accredited_until },
    access,
  );
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).reason, 'SchemaNotYours');

  const accepted = await post(
    select,
    { name: 'Test TI', schemas: ['InvitationTest'], accredited_until },
    access,
  );
  assert.equal(accepted.status, 201);
  const child = await accepted.json();
  organizations.push(child.organization_id);
  assert.equal(child.kind, 'ti');
  assert.deepEqual(child.schemas, ['InvitationTest']);

  const unrelated = await post(select, { name: 'Other TAO' }, rootToken);
  assert.equal(unrelated.status, 201);
  const sibling = await unrelated.json();
  organizations.push(sibling.organization_id);

  const rootChain = await (await read(rootToken)).json();
  assert.equal(rootChain.selects, 'tao');
  assert.equal(rootChain.accredited.length, 2);
  assert.equal(
    rootChain.accredited.find((row) => row.name === 'Test TAO').accredited[0].name,
    'Test TI',
  );
  assert.ok(rootChain.available_schemas.some((item) => item.credential_type === 'InvitationTest'));

  const taoChain = await (await read(access)).json();
  assert.equal(taoChain.selects, 'ti');
  assert.deepEqual(
    taoChain.available_schemas.map((item) => item.credential_type),
    ['InvitationTest'],
  );
  assert.deepEqual(
    taoChain.accredited.map((row) => row.name),
    ['Test TI'],
  );
  assert.equal(taoChain.accredited[0].invitation, undefined);
  assert.equal(taoChain.accredited[0].invitation_digest, undefined);

  assert.equal(
    (await post(renew, { organization_id: child.organization_id }, rootToken)).status,
    403,
  );
  assert.equal(
    (await post(renew, { organization_id: selected.organization_id }, rootToken)).status,
    409,
  );
  const renewal = await post(renew, { organization_id: child.organization_id }, access);
  assert.equal(renewal.status, 200);
  const replacement = await renewal.json();
  assert.notEqual(replacement.invitation, child.invitation);
  const old = await post(register, {
    ...signup,
    invitation: child.invitation,
    username: 'test-ti',
  });
  assert.equal(old.status, 404);

  await database.query(
    'UPDATE accredited_organizations SET invitation_expires_at = now() WHERE id = $1',
    [child.organization_id],
  );
  const expired = await post(register, {
    ...signup,
    invitation: replacement.invitation,
    username: 'test-ti',
  });
  assert.equal(expired.status, 404);

  const tiId = { organization_id: child.organization_id };
  const lifespan = '/registry/trust-chain/lifespan/';
  assert.equal((await post(lifespan, { ...tiId, end_now: true }, rootToken)).status, 403);
  const ended = await post(lifespan, { ...tiId, end_now: true }, access);
  assert.equal(ended.status, 200);
  assert.equal((await ended.json()).accreditation_ended, true);
  const repeated = await post(lifespan, { ...tiId, end_now: true }, access);
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).reason, 'AlreadyEnded');
  const extended = await post(lifespan, { ...tiId, accredited_until }, access);
  assert.equal(extended.status, 200);
  assert.equal((await extended.json()).accreditation_ended, false);

  const grants = '/registry/trust-chain/schemas/';
  assert.equal((await post(grants, { ...tiId, schemas: [] }, rootToken)).status, 403);
  const removed = await post(
    grants,
    { organization_id: selected.organization_id, schemas: [] },
    rootToken,
  );
  assert.equal(removed.status, 200);
  const afterRemoval = await (await read(access)).json();
  assert.deepEqual(afterRemoval.available_schemas, []);
  assert.deepEqual(afterRemoval.accredited[0].schemas, []);
  const regrant = await post(grants, { ...tiId, schemas: ['InvitationTest'] }, access);
  assert.equal(regrant.status, 403);
  assert.equal((await regrant.json()).reason, 'SchemaNotYours');

  await database.query(`
    INSERT INTO certificate_schemas (credential_type, name_sk) VALUES ('InvitationDraft', 'Draft')
  `);
  await database.query(`
    INSERT INTO certificate_schema_versions (schema_id, version, fields, tsr_id, registered_at)
    SELECT s.id, v.number, v.fields::jsonb, v.tsr, CASE WHEN v.tsr IS NOT NULL THEN now() END
    FROM certificate_schemas s CROSS JOIN (VALUES
      (1, '[{"key":"old"}]', 'test-v1'),
      (2, '[{"key":"current","kind":"integer","required":true},{"key":"body","kind":"text","organization":true}]', 'test-v2'),
      (3, '[{"key":"draft"}]', NULL)
    ) v(number, fields, tsr)
    WHERE s.credential_type = 'InvitationTest'
  `);
  await database.query(
    `
    INSERT INTO organization_certificate_schemas
    SELECT organization.id, schema.id
    FROM accredited_organizations organization CROSS JOIN certificate_schemas schema
    WHERE organization.id = ANY($1::uuid[]) AND schema.credential_type IN ('InvitationTest', 'InvitationDraft')
  `,
    [[selected.organization_id, child.organization_id]],
  );
  const renewed = await post(renew, tiId, access);
  assert.equal(renewed.status, 200);
  const latest = await renewed.json();
  const tiSignup = { ...signup, invitation: latest.invitation, username: 'test-ti', kind: 'ti' };
  assert.equal((await post(register, tiSignup)).status, 201);
  const tiLogin = await post('/api/api-token-auth', tiSignup);
  const tiToken = (await tiLogin.json()).access;
  const scheme = async (token) => {
    const response = await fetch(origin + '/registry/certificate-scheme/', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const issuance = await scheme(tiToken);
  assert.deepEqual(
    issuance.schemas.map(({ credential_type, version }) => [credential_type, version]),
    [['InvitationTest', 2]],
  );
  assert.equal(issuance.credential_type, 'InvitationTest');
  assert.deepEqual(
    issuance.fields.map((field) => field.key),
    ['current', 'body'],
  );

  await database.query(
    `
    UPDATE accredited_organizations SET did = 'did:ebsi:zTest', tir_attribute_id = 'test-attribute' WHERE id = $1
  `,
    [child.organization_id],
  );
  const {
    rows: [tiAccount],
  } = await database.query("SELECT id FROM operator_accounts WHERE username = 'test-ti'");
  const registration = postgresCertificateRegistration(database, {
    protection,
    publicOrigin: 'https://issuer.example',
    ensureAccredited: async (did, type) => {
      assert.equal(did, 'did:ebsi:zTest');
      assert.equal(type, 'InvitationTest');
    },
  });
  const request = {
    holder_reference: 'case-42',
    credential_type: 'InvitationTest',
    claims: { certificateNumber: 'Číslo-42', current: '7', body: 'Untrusted input' },
  };
  await assert.rejects(
    registration.register(tiAccount.id, { ...request, claims: { current: 'bad' } }),
    (error) => error instanceof IssuanceError && error.body.reason === 'InvalidClaims',
  );
  const outcomes = await Promise.allSettled([
    registration.register(tiAccount.id, request),
    registration.register(tiAccount.id, request),
  ]);
  const registered = outcomes.find((outcome) => outcome.status === 'fulfilled')?.value;
  assert.ok(registered);
  // The record key exists once the holder collects the credential: it is computed from the
  // TI and the collected credential's id.
  assert.equal((registered as Record<string, unknown>).status_key, undefined);
  assert.equal(
    outcomes.find((outcome) => outcome.status === 'rejected').reason.body.reason,
    'CertificateNumberTaken',
  );
  const offerUrl = new URL(new URL(registered.offer_uri).searchParams.get('credential_offer_uri'));
  const code = offerUrl.pathname.split('/').at(-1);
  const offered = await registration.offer(code);
  assert.deepEqual(offered.credential_configuration_ids, ['InvitationTest']);
  assert.deepEqual(offered.grants[preAuthorizedGrant].tx_code, {
    input_mode: 'numeric',
    length: 6,
    description:
      'PIN, ktorý ste dostali od vydávajúceho orgánu. / The PIN you received from the issuing body.',
  });
  assert.match(registered.pin, /^\d{6}$/);
  const {
    rows: [stored],
  } = await database.query(
    `
    SELECT c.private_data, o.code_digest, o.pin_digest FROM registered_certificates c
    JOIN credential_offers o ON o.certificate_id = c.id WHERE c.id = $1
  `,
    [registered.certificate_id],
  );
  assert.equal(stored.private_data.includes(Buffer.from('case-42')), false);
  assert.notEqual(stored.code_digest.toString(), code);
  assert.notEqual(stored.pin_digest.toString(), registered.pin);
  assert.deepEqual(protection.open(registered.certificate_id, stored.private_data), {
    holder_reference: 'case-42',
    claims: { certificateNumber: 'Číslo-42', current: 7, body: 'Test TI' },
  });
  assert.deepEqual((await scheme(access)).schemas, []);
  const tokenExchange = postgresCredentialTokenExchange(database, protection, {
    issuer: issuerOrigin,
    signing: authorization,
  });
  // OpenID4VCI 1.0: the separately delivered PIN is the transaction code.
  const grant = (offerCode, pin?: string) =>
    tokenExchange.exchange({
      grant_type: preAuthorizedGrant,
      'pre-authorized_code': offerCode,
      tx_code: pin,
    });
  const wrongPin = (pin) => (pin === '000000' ? '000001' : '000000');
  // OpenID4VCI 1.0, section 6.3: a missing transaction code is an invalid request, a wrong
  // one an invalid grant.
  assert.equal((await grant(code)).body.error, 'invalid_request');
  assert.equal((await grant(code, wrongPin(registered.pin))).body.error, 'invalid_grant');
  const {
    rows: [afterWrongPin],
  } = await database.query(
    'SELECT failed_attempts FROM credential_offers WHERE certificate_id = $1',
    [registered.certificate_id],
  );
  assert.equal(afterWrongPin.failed_attempts, 1);
  const exchanges = await Promise.all([grant(code, registered.pin), grant(code, registered.pin)]);
  assert.deepEqual(exchanges.map((result) => result.status).sort(), [200, 400]);
  const issued = exchanges.find((result) => result.status === 200).body;
  assert.equal(issued.token_type, 'Bearer');
  // No c_nonce in the token response: the Nonce Endpoint issues it.
  assert.equal((issued as Record<string, unknown>).c_nonce, undefined);
  const {
    rows: [tokenRow],
  } = await database.query('SELECT token_digest FROM credential_tokens WHERE certificate_id = $1', [
    registered.certificate_id,
  ]);
  assert.deepEqual(tokenRow.token_digest, secretDigest(issued.access_token));
  const nonces = postgresCredentialNonces(database);
  const freshNonce = async () => (await nonces.issue()).nonce;
  assert.equal(await registration.offer(code), undefined);

  const holder = await holderKey();
  const otherHolder = await holderKey();
  let finalizationAttempts = 0;
  let expectedHolder = holder.did;
  const redemption = postgresCredentialRedemption(database, {
    protection,
    audience: issuerOrigin,
    nonces,
    finalize: async ({ certificate, claims, subject }) => {
      assert.equal(certificate.id, registered.certificate_id);
      assert.equal(subject, expectedHolder);
      assert.equal(claims.current, 7);
      if (++finalizationAttempts === 1) throw new Error('Simulated signer failure');
      return new SignJWT({
        sub: subject,
        vc: {
          id: certificate.credential_id,
          validFrom: new Date().toISOString(),
          issuanceDate: new Date().toISOString(),
          expirationDate: new Date(Date.now() + 86400000).toISOString(),
        },
      })
        .setProtectedHeader({ alg: 'ES256' })
        .sign(issuerPrivateKey);
    },
  });
  // OpenID4VCI 1.0: one configuration, one key proof in proofs.
  const credentialRequest = { credential_configuration_id: 'InvitationTest' };
  const redeem = (proof) =>
    redemption.redeem(issued.access_token, { ...credentialRequest, proofs: { jwt: [proof] } });
  assert.equal(
    (await redemption.redeem(issued.access_token, { ...credentialRequest, proof: 'x' })).body.error,
    'invalid_credential_request',
  );
  assert.equal(
    (
      await redemption.redeem(issued.access_token, {
        credential_configuration_id: 'OtherType',
        proofs: { jwt: [await holder.proof(await freshNonce(), issuerOrigin)] },
      })
    ).body.error,
    'unknown_credential_configuration',
  );
  assert.equal(
    (await redeem(await holder.proof('wrong-nonce', issuerOrigin))).body.error,
    'invalid_nonce',
  );
  for (const proof of [
    await holder.proof(await freshNonce(), 'https://different-issuer.example'),
    await holder.proof(await freshNonce(), issuerOrigin, Math.floor(Date.now() / 1000) - 30),
  ]) {
    assert.equal((await redeem(proof)).body.error, 'invalid_proof');
  }
  const proof = await holder.proof(await freshNonce(), issuerOrigin);
  await assert.rejects(redeem(proof), /Simulated signer failure/);
  const boundOffer = await post(
    '/registry/reoffer/',
    { credential_id: registered.credential_id },
    tiToken,
  );
  assert.equal(
    boundOffer.status,
    200,
    'An uncollected failed attempt may be reoffered immediately.',
  );
  await database.query(
    'UPDATE credential_tokens SET expires_at = now() WHERE certificate_id = $1',
    [registered.certificate_id],
  );
  assert.equal((await redeem(proof)).status, 401);

  const recoveryResponse = await post(
    '/registry/reoffer/',
    { credential_id: registered.credential_id },
    tiToken,
  );
  assert.equal(recoveryResponse.status, 200);
  const recoveredOffer = await recoveryResponse.json();
  const recoveredUrl = new URL(
    new URL(recoveredOffer.offer_uri).searchParams.get('credential_offer_uri'),
  );
  const recoveredCode = recoveredUrl.pathname.split('/').at(-1);
  const recoveredExchanges = await Promise.all([
    grant(recoveredCode, recoveredOffer.pin),
    grant(recoveredCode, recoveredOffer.pin),
  ]);
  assert.deepEqual(recoveredExchanges.map((result) => result.status).sort(), [200, 400]);
  const recovered = recoveredExchanges.find((result) => result.status === 200).body;
  assert.notEqual(recovered.access_token, issued.access_token);
  const redeemRecovered = (proof) =>
    redemption.redeem(recovered.access_token, { ...credentialRequest, proofs: { jwt: [proof] } });
  const otherProof = await otherHolder.proof(await freshNonce(), issuerOrigin);
  assert.equal(
    (await redeemRecovered(await otherHolder.proof('wrong-nonce', issuerOrigin))).body.error,
    'invalid_nonce',
  );
  expectedHolder = otherHolder.did;
  const recoveredProof = otherProof;
  const redemptions = await Promise.all([
    redeemRecovered(recoveredProof),
    redeemRecovered(recoveredProof),
  ]);
  assert.deepEqual(redemptions.map((result) => result.status).sort(), [200, 401]);
  assert.equal(
    (
      await jwtVerify(
        redemptions.find((result) => result.status === 200).body.credentials[0].credential,
        issuerPublicKey,
      )
    ).payload.sub,
    otherHolder.did,
  );
  assert.equal(finalizationAttempts, 2);
  const {
    rows: [redeemed],
  } = await database.query('SELECT redeemed_at FROM credential_tokens WHERE certificate_id = $1', [
    registered.certificate_id,
  ]);
  assert.ok(redeemed.redeemed_at);

  async function additionalOffer(number) {
    const offer = await registration.register(tiAccount.id, {
      ...request,
      claims: { ...request.claims, certificateNumber: number },
    });
    const url = new URL(new URL(offer.offer_uri).searchParams.get('credential_offer_uri'));
    return { code: url.pathname.split('/').at(-1), pin: offer.pin, id: offer.credential_id };
  }
  const locked = await additionalOffer('locked');
  const pendingWithdrawal = await additionalOffer('pending-withdrawal');
  const toReplace = await additionalOffer('replaceable');
  const oldBearer = (await grant(toReplace.code, toReplace.pin)).body.access_token;
  assert.ok(oldBearer);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await grant(locked.code, wrongPin(locked.pin))).status, 400);
  }
  assert.equal((await grant(locked.code, locked.pin)).status, 400);
  assert.equal(await registration.offer(locked.code), undefined);
  assert.ok(await registration.offer(pendingWithdrawal.code));

  const issuePath = '/registry/issue/';
  assert.equal((await post(issuePath, request, rootToken)).status, 403);
  const issueResponse = await post(
    issuePath,
    {
      ...request,
      qr: true,
      claims: { ...request.claims, certificateNumber: 'http-issuance' },
    },
    tiToken,
  );
  assert.equal(issueResponse.status, 201);
  const httpOffer = await issueResponse.json();
  assert.match(httpOffer.qr, /^data:image\/png;base64,/);
  const reference = new URL(new URL(httpOffer.offer_uri).searchParams.get('credential_offer_uri'));
  const offerResponse = await fetch(origin + reference.pathname);
  assert.equal(offerResponse.status, 200);
  const offerBody = await offerResponse.json();
  const issuerMetadata = await (
    await fetch(origin + '/.well-known/openid-credential-issuer')
  ).json();
  const authMetadata = await (await fetch(origin + '/.well-known/openid-configuration')).json();
  assert.deepEqual(issuerMetadata.authorization_servers, [offerBody.credential_issuer]);
  assert.equal(
    issuerMetadata.credential_configurations_supported[offerBody.credential_configuration_ids[0]]
      .format,
    'jwt_vc_json',
  );
  const tokenResponse = await fetch(origin + new URL(authMetadata.token_endpoint).pathname, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: preAuthorizedGrant,
      'pre-authorized_code': offerBody.grants[preAuthorizedGrant]['pre-authorized_code'],
      tx_code: httpOffer.pin,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  const nonceResponse = await fetch(origin + new URL(issuerMetadata.nonce_endpoint).pathname, {
    method: 'POST',
  });
  assert.equal(nonceResponse.status, 200);
  assert.equal(nonceResponse.headers.get('cache-control'), 'no-store');
  const { c_nonce } = await nonceResponse.json();
  const credentialPath = new URL(issuerMetadata.credential_endpoint).pathname;
  const signedProof = await holder.proof(c_nonce, issuerMetadata.credential_issuer);
  const credentialResponse = await post(
    credentialPath,
    {
      credential_configuration_id: offerBody.credential_configuration_ids[0],
      proofs: { jwt: [signedProof] },
    },
    token.access_token,
  );
  assert.equal(credentialResponse.status, 200);
  const {
    credentials: [{ credential }],
  } = await credentialResponse.json();
  const { payload } = await jwtVerify(credential.split('~')[0], issuerPublicKey, {
    issuer: 'did:ebsi:zTest',
    subject: holder.did,
    algorithms: ['ES256'],
  });
  assert.equal(
    (payload.vc as { credentialSubject: { certificateNumber: string } }).credentialSubject
      .certificateNumber,
    'http-issuance',
  );
  assert.equal(ledgerRecords.length, 0, 'Collection must not wait for the ledger worker.');
  await issuer.deliverRegistrations();
  // Recorded under the key of the TI and the collected credential's id, with its hash.
  const collectedKey = '0x' + certificateStatusKey('did:ebsi:zTest', payload.jti).toString('hex');
  assert.ok(ledgerRecords.some((record) => record.statusKey === collectedKey));

  const otherSignup = {
    invitation: sibling.invitation,
    username: 'test-other-tao',
    password: 'other-tao-password',
  };
  assert.equal((await post(register, otherSignup)).status, 201);
  const { access: otherTaoToken } = await (await post('/api/api-token-auth', otherSignup)).json();
  const list = async (query = '', bearer = tiToken) => {
    const response = await fetch(origin + '/registry/certificates/' + query, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const page = await list('?limit=1');
  assert.equal(page.count, 1);
  assert.equal(page.next, 1);
  assert.equal(page.results[0].credential_id, payload.jti);
  assert.equal(page.results[0].registered_id, httpOffer.credential_id);
  assert.equal(page.results[0].collected, true);
  const outside = await list('', otherTaoToken);
  assert.equal(outside.total, 0);
  assert.equal((await list('?q=CASE-42')).total, page.total);
  const refresh = postgresStandingRefresh(database, {
    async status(key) {
      const record = ledgerRecords.find((item) => item.statusKey === key);
      if (!record) throw new Error('Unconfirmed in fixture ledger');
      return {
        standing: 2n,
        issuerDid: record.issuer,
        credentialHash: record.credentialHash,
        validFrom: BigInt(record.validFrom),
        validUntil: BigInt(record.validUntil),
      };
    },
  });
  await database.query(
    `
    UPDATE registered_certificates SET ledger_observed_at = now() - interval '10 minutes'
    WHERE credential_id = $1 OR registered_id = $1
  `,
    [httpOffer.credential_id],
  );
  assert.equal((await list('?q=http-issuance')).results[0].state, 'active');
  await refresh();
  const suspendedPage = await list('?state=suspended&q=http-issuance');
  // A ledger observation is verifier evidence, not a locally applied decision.
  assert.equal(suspendedPage.total, 0);
  assert.equal(suspendedPage.summary.suspended, 0);
  assert.equal((await list('?q=http-issuance')).results[0].state, 'active');

  let presentedStanding = 1n;
  const isIssuerRevoked = postgresIssuerRevocation(database);
  const verifyPresentation = presentationVerifier(
    credentialVerifier({
      isIssuerRevoked,
      assertionKey: async () => exportJWK(issuerPublicKey),
      checkAccreditation: async () => {},
      ledgerStatusSchema: 'https://tsr.example/schemas/ledger-status',
      ledger: {
        chainId: 1337,
        contract: '0x' + 'ab'.repeat(20),
        async status(key) {
          const record = ledgerRecords.find((item) => item.statusKey === key);
          return {
            standing: presentedStanding,
            issuerDid: record.issuer,
            credentialHash: record.credentialHash,
            validFrom: BigInt(record.validFrom),
            validUntil: BigInt(record.validUntil),
          };
        },
      },
    }),
  );
  const challenge = {
    audience: 'https://verifier.example',
    nonce: 'challenge',
    state: 'session',
    credentialTypes: ['InvitationTest'],
  };
  const presentation = await holder.presentation(
    [credential],
    challenge.audience,
    challenge.nonce,
    challenge.state,
  );
  const [verified] = await verifyPresentation(presentation, challenge);
  assert.equal(verified.credentialId, payload.jti);
  assert.equal(Object.hasOwn(verified, 'subject'), false);
  await assert.rejects(verifyPresentation(presentation, { ...challenge, nonce: 'other' }), {
    code: 'InvalidPresentationBinding',
  });
  await assert.rejects(verifyPresentation(presentation, { ...challenge, state: 'other' }), {
    code: 'InvalidPresentationBinding',
  });
  await assert.rejects(
    verifyPresentation(presentation, { ...challenge, audience: 'https://other.example' }),
    { code: 'InvalidPresentationSignature' },
  );
  await assert.rejects(
    verifyPresentation(presentation, { ...challenge, credentialTypes: ['WrongType'] }),
    { code: 'UnexpectedCredentialType' },
  );
  const borrowed = await otherHolder.presentation(
    [credential],
    challenge.audience,
    challenge.nonce,
    challenge.state,
  );
  await assert.rejects(verifyPresentation(borrowed, challenge), {
    code: 'InvalidCredentialBinding',
  });
  const duplicate = await holder.presentation(
    [credential, credential],
    challenge.audience,
    challenge.nonce,
    challenge.state,
  );
  await assert.rejects(verifyPresentation(duplicate, challenge), { code: 'DuplicateCredential' });

  const sessions = postgresPresentationSessions(database, {
    verifyPresentation,
    protection,
    audience: challenge.audience,
  });
  assert.equal(await sessions.create(account.id, challenge.credentialTypes), undefined);
  const session = await sessions.create(tiAccount.id, challenge.credentialTypes);
  assert.deepEqual(await sessions.result(tiAccount.id, session.state), { status: 'pending' });
  assert.equal(await sessions.result(account.id, session.state), undefined);
  await assert.rejects(sessions.submit(session.state, presentation), {
    code: 'InvalidPresentationBinding',
  });
  const responseJwt = await holder.presentation(
    [credential],
    session.audience,
    session.nonce,
    session.state,
  );
  const submissions = await Promise.all([
    sessions.submit(session.state, responseJwt),
    sessions.submit(session.state, responseJwt),
  ]);
  assert.deepEqual(submissions.sort(), [false, true]);
  assert.equal(await sessions.challenge(session.state), undefined);
  const result = await sessions.result(tiAccount.id, session.state);
  assert.equal(result.status, 'done');
  if (result.status !== 'done') assert.fail('Expected a completed presentation');
  assert.equal(result.outcome, 'VALID');
  assert.equal(result.credentials[0].attributes.current, 7);
  assert.equal(Object.hasOwn(result.credentials[0], 'subject'), false);
  const {
    rows: [storedResult],
  } = await database.query(
    'SELECT evidence, disclosed_data FROM presentation_sessions WHERE state = $1',
    [session.state],
  );
  assert.equal(storedResult.disclosed_data.includes(Buffer.from('current')), false);
  assert.equal(storedResult.evidence[0].attributes, undefined);
  await database.query(
    'UPDATE presentation_sessions SET attributes_until = now() WHERE state = $1',
    [session.state],
  );
  const purged = await sessions.result(tiAccount.id, session.state);
  if (purged.status !== 'done') assert.fail('Expected a completed presentation');
  assert.deepEqual(purged.credentials[0].attributes, {});
  assert.equal(await sessions.purgeAttributes(), 1);
  const expiredSession = await sessions.create(tiAccount.id, challenge.credentialTypes);
  await database.query('UPDATE presentation_sessions SET expires_at = now() WHERE state = $1', [
    expiredSession.state,
  ]);
  assert.deepEqual(await sessions.result(tiAccount.id, expiredSession.state), {
    status: 'expired',
  });
  assert.equal(await sessions.submit(expiredSession.state, responseJwt), false);

  const profile = await walletPresentationProfile(challenge.audience, sessions, 'InvitationTest');
  const verificationServer = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    presentations: profile,
  });
  verificationServer.listen(0, '127.0.0.1');
  await once(verificationServer, 'listening');
  context.after(() => new Promise((resolve) => verificationServer.close(resolve)));
  const verifierOrigin = `http://127.0.0.1:${(verificationServer.address() as AddressInfo).port}`;
  const verifierRequest = (path, token = tiToken) =>
    fetch(verifierOrigin + path, {
      headers: { authorization: `Bearer ${token}` },
    });
  assert.equal((await verifierRequest('/registry/presentation-offer/', rootToken)).status, 403);
  const offerReply = await verifierRequest('/registry/presentation-offer/');
  assert.equal(offerReply.status, 200);
  const presentationOffer = await offerReply.json();
  const requestUrl = new URL(new URL(presentationOffer.offer_uri).searchParams.get('request_uri'));
  const fetchedRequest = await fetch(verifierOrigin + requestUrl.pathname);
  // RFC 9101: the request object itself, typed oauth-authz-req+jwt.
  assert.equal(fetchedRequest.headers.get('content-type'), 'application/oauth-authz-req+jwt');
  const requestJwt = await fetchedRequest.text();
  const {
    keys: [requestJwk],
  } = await (await fetch(verifierOrigin + '/auth/jwks')).json();
  // OpenID4VP 1.0: a signed request object with a DCQL query, answered by direct_post.
  const { payload: signedRequest, protectedHeader } = await jwtVerify<{
    state: string;
    client_id: string;
    nonce: string;
    response_uri: string;
    response_mode: string;
    dcql_query: { credentials: { id: string; meta: { type_values: string[][] } }[] };
  }>(requestJwt, await importJWK(requestJwk, 'ES256'));
  assert.equal(protectedHeader.typ, 'oauth-authz-req+jwt');
  assert.equal(signedRequest.state, presentationOffer.state);
  assert.equal(signedRequest.response_mode, 'direct_post');
  assert.deepEqual(signedRequest.dcql_query.credentials[0].meta.type_values, [['InvitationTest']]);
  const poll = '/registry/presentation-result/?state=' + presentationOffer.state;
  assert.deepEqual(await (await verifierRequest(poll)).json(), { status: 'pending' });
  const vpToken = await holder.presentation(
    [credential],
    signedRequest.client_id,
    signedRequest.nonce,
    signedRequest.state,
  );
  // The vp_token is a JSON object of presentations by credential query id.
  const callback = (token: unknown = { certificate: [vpToken] }) =>
    fetch(verifierOrigin + new URL(signedRequest.response_uri).pathname, {
      method: 'POST',
      body: new URLSearchParams({
        state: presentationOffer.state,
        vp_token: typeof token === 'string' ? token : JSON.stringify(token),
      }),
    });
  assert.equal((await callback(vpToken)).status, 400);
  assert.equal((await callback({ other: [vpToken] })).status, 400);
  assert.equal((await callback()).status, 200);
  assert.equal((await callback()).status, 400);
  assert.equal((await (await verifierRequest(poll)).json()).outcome, 'VALID');

  presentedStanding = 2n;
  const refusedOffer = await (await verifierRequest('/registry/presentation-offer/')).json();
  const refusedPoll = '/registry/presentation-result/?state=' + refusedOffer.state;
  const refusedSession = await sessions.challenge(refusedOffer.state);
  const callbackFor = async (holderKey) =>
    fetch(verifierOrigin + '/auth/direct_post', {
      method: 'POST',
      body: new URLSearchParams({
        state: refusedOffer.state,
        vp_token: JSON.stringify({
          certificate: [
            await holderKey.presentation(
              [credential],
              refusedSession.audience,
              refusedSession.nonce,
              refusedOffer.state,
            ),
          ],
        }),
      }),
    });
  assert.equal((await callbackFor(otherHolder)).status, 400);
  assert.deepEqual(await (await verifierRequest(refusedPoll)).json(), { status: 'pending' });
  const refusedCallback = await callbackFor(holder);
  assert.equal(refusedCallback.status, 400);
  assert.equal((await refusedCallback.json()).error_description, 'Suspended');
  const refusedResult = await (await verifierRequest(refusedPoll)).json();
  assert.equal(refusedResult.outcome, 'SUSPENDED');
  assert.equal(refusedResult.verified, false);
  assert.equal(refusedResult.checks.standing_valid, false);
  assert.deepEqual(refusedResult.credentials, []);
  assert.equal(refusedResult.attributes_until, null);
  assert.equal((await callbackFor(holder)).status, 400);
  const replay = await post(
    credentialPath,
    {
      credential_configuration_id: offerBody.credential_configuration_ids[0],
      proofs: { jwt: [signedProof] },
    },
    token.access_token,
  );
  assert.equal(replay.status, 401);
  const collected = await post(
    '/registry/reoffer/',
    { credential_id: httpOffer.credential_id },
    tiToken,
  );
  assert.equal(collected.status, 409);
  assert.equal((await collected.json()).reason, 'OfferAlreadyRedeemed');

  await database.query(
    "UPDATE certificate_schemas SET retired_at = now() WHERE credential_type = 'InvitationTest'",
  );
  assert.deepEqual((await scheme(tiToken)).schemas, []);
  await database.query(
    "UPDATE certificate_schemas SET retired_at = NULL WHERE credential_type = 'InvitationTest'",
  );
  assert.equal((await post(lifespan, { ...tiId, end_now: true }, access)).status, 200);
  const afterEnd = await scheme(tiToken);
  assert.deepEqual(afterEnd.schemas, []);
  assert.equal(afterEnd.accreditation_ended, true);
  const replacedResponse = await post(
    '/registry/reoffer/',
    { credential_id: toReplace.id },
    tiToken,
  );
  assert.equal(replacedResponse.status, 200);
  const replacementOffer = await replacedResponse.json();
  const replacementUrl = new URL(
    new URL(replacementOffer.offer_uri).searchParams.get('credential_offer_uri'),
  );
  const replacementCode = replacementUrl.pathname.split('/').at(-1);
  assert.notEqual(replacementCode, toReplace.code);
  assert.equal(await registration.offer(toReplace.code), undefined);
  assert.equal((await grant(toReplace.code, toReplace.pin)).status, 400);
  assert.equal((await redemption.redeem(oldBearer, credentialRequest)).status, 401);
  assert.equal((await grant(replacementCode, replacementOffer.pin)).status, 200);

  const stillInvited = await post(select, { name: 'Pending TI', accredited_until }, access);
  assert.equal(stillInvited.status, 201);
  const pending = await stillInvited.json();
  organizations.push(pending.organization_id);
  const revoke = '/registry/trust-chain/revoke/';
  const taoId = { organization_id: selected.organization_id };
  const noNote = await post(revoke, { ...taoId, reason: 'other' }, rootToken);
  assert.equal(noNote.status, 400);
  assert.equal((await noNote.json()).reason, 'RevocationNoteRequired');
  const attemptsToRevoke = await Promise.all([
    post(revoke, { ...taoId, reason: 'breach' }, rootToken),
    post(revoke, { ...taoId, reason: 'breach' }, rootToken),
  ]);
  assert.deepEqual(attemptsToRevoke.map((response) => response.status).sort(), [200, 409]);
  const acceptedRevocation = await attemptsToRevoke.find((response) => response.ok).json();
  assert.equal(acceptedRevocation.withdrawal_pending, true);
  assert.equal(await isIssuerRevoked('did:ebsi:zTest'), true);
  presentedStanding = 1n;
  await assert.rejects(verifyPresentation(presentation, challenge), {
    code: 'AccreditationRevoked',
    outcome: 'REVOKED',
  });
  assert.equal(await registration.offer(pendingWithdrawal.code), undefined);
  assert.equal((await grant(pendingWithdrawal.code, pendingWithdrawal.pin)).status, 400);
  assert.equal((await read(access)).status, 401);
  const voided = await post(register, {
    ...signup,
    invitation: pending.invitation,
    username: 'test-pending-ti',
  });
  assert.equal(voided.status, 404);
  const afterRevocation = await (await read(rootToken)).json();
  const revokedTao = afterRevocation.accredited.find(
    (row) => row.organization_id === selected.organization_id,
  );
  assert.equal(revokedTao.revoked.own, true);
  assert.equal(revokedTao.accredited[0].revoked.own, false);
  assert.equal(revokedTao.accredited[0].invitation_expires_at, null);
  const { rows: withdrawals } = await database.query(
    `
    SELECT affected_organization_id, tir_completed_at, certificates_completed_at
    FROM accreditation_withdrawals WHERE revoked_organization_id = $1
  `,
    [selected.organization_id],
  );
  assert.deepEqual(
    new Set(withdrawals.map((row) => row.affected_organization_id)),
    new Set([selected.organization_id, child.organization_id, pending.organization_id]),
  );
  assert.ok(withdrawals.every((row) => !row.tir_completed_at && row.certificates_completed_at));
  assert.ok(acceptedRevocation.suspended > 0);
  assert.ok(acceptedRevocation.revocations_proposed > 0);
});
