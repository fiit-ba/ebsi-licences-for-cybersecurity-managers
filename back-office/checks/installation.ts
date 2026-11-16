import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { actualWalletClients } from '../server/issuance/fixtures/wallet.ts';
import { actualBackupWallet } from '../server/backup/fixtures/wallet.ts';
import { actualHolderWallet } from '../server/verification/fixtures/holder-wallet.ts';
import { verificationHolder } from '../server/verification/fixtures/runtime.ts';

if (process.env.ATEST_INSTALLATION_TEST !== 'isolated')
  throw new Error(
    'Use only a task-owned disposable installation (ATEST_INSTALLATION_TEST=isolated).',
  );
try {
  const origin = process.env.BACK_OFFICE_ACCEPTANCE_ORIGIN!;
  const username = process.env.BACK_OFFICE_ACCEPTANCE_USERNAME!;
  const password = (
    await readFile(process.env.BACK_OFFICE_ACCEPTANCE_PASSWORD_FILE!, 'utf8')
  ).trim();
  const wallet = await actualWalletClients(origin);
  const root = await wallet.authenticateOrganization(username, password);
  assert.ok(root.access);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const type = 'CybersecurityManagerCertificate';

  /**
   * Send a real installation API request and assert its expected status.
   * @param path - Existing direct route.
   * @param token - Operator bearer, or empty for public calls.
   * @param body - JSON body, omitted for GET.
   * @param expected - Expected HTTP status.
   * @returns Parsed API response without replacing any HTTP behavior.
   * @throws Assertion, HTTP transport or JSON errors.
   */
  async function api(path: string, token = '', body?: unknown, expected = 200) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }

  const fields = [
    {
      key: 'certificateNumber',
      kind: 'text',
      required: true,
      default: '',
      organization: false,
      section: 'certificate',
      label: { sk: 'Číslo osvedčenia', en: 'Certificate number' },
      hint: { sk: '', en: '' },
    },
  ];
  const seeded = process.env.BACK_OFFICE_ACCEPTANCE_SEEDED === 'true';
  const schema = seeded
    ? (await api('/registry/schemas/', root.access)).schemas.find(
        (item: { credential_type: string }) => item.credential_type === type,
      )
    : await api(
        '/registry/schemas/',
        root.access,
        {
          credential_type: type,
          name_sk: 'Installation test',
          name_en: 'Installation test',
          fields,
        },
        201,
      );
  if (seeded)
    assert.equal(
      schema.versions[0].fields.length,
      15,
      'Ordinary bootstrap must restore the complete certificate form.',
    );
  if (seeded) {
    for (const [username, role, governance] of [
      ['alice', 'plr_issuer', 'A'],
      ['bob', 'plr_status_manager', 'B'],
      ['supervisor', 'plr_rtao', ''],
      ['mirri', 'plr_tao', ''],
    ]) {
      const session = await wallet.authenticateOrganization(username, password);
      const profile = await wallet.fetchOrganizationAccount(session.access);
      assert.ok(profile.roles.includes(role), 'Missing seeded role for ' + username);
      if (governance) assert.ok(profile.governance_roles.includes(governance));
      if (username === 'alice')
        assert.equal(
          (await wallet.fetchCertificateScheme(session.access)).schemas[0].fields.length,
          15,
        );
    }
  }
  const schemaId = schema.credential_type;
  assert.ok(schemaId, JSON.stringify(schema));
  const taoSelection = await api(
    '/registry/trust-chain/select/',
    root.access,
    { name: 'Installation TAO ' + suffix, kind: 'tao', schemas: [schemaId] },
    201,
  );
  const taoName = 'tao.' + suffix;
  await api(
    '/organizations/v1/registrations/',
    '',
    { invitation: taoSelection.invitation, username: taoName, password, kind: 'tao' },
    201,
  );
  const tao = await wallet.authenticateOrganization(taoName, password);
  // A licence gets its record once its TI is set up on the governance contract, which belongs to
  // the TAO it was deployed for: the seeded TAO. A new TAO's TIs issue, but get no record.
  const accreditor = seeded ? await wallet.authenticateOrganization('mirri', password) : tao;
  const tiSelection = await api(
    '/registry/trust-chain/select/',
    accreditor.access,
    {
      name: 'Installation TI ' + suffix,
      kind: 'ti',
      schemas: [schemaId],
      accredited_until: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    },
    201,
  );
  const tiName = 'ti.' + suffix;
  await wallet.registerOrganizationAccount(tiSelection.invitation, tiName, password);
  await assert.rejects(
    wallet.registerOrganizationAccount(tiSelection.invitation, 'replay.' + suffix, password),
  );
  const ti = await wallet.authenticateOrganization(tiName, password);
  const profile = await wallet.fetchOrganizationAccount(ti.access);
  assert.ok(profile.roles.includes('plr_issuer'));
  const schemes = await wallet.fetchCertificateScheme(ti.access);
  assert.equal(schemes.schemas[0].credential_type, type);
  const catalog = await api('/registry/schema-names/');
  assert.ok(JSON.stringify(catalog).includes(type));
  await api('/registry/schemas/', ti.access, {}, 403);
  // The worker publishes a newly registered TI in the development registries; issuance waits
  // until it is an issuer. A refused offer creates nothing, so asking again is safe.
  const createOffer = () =>
    wallet.createCertificateOffer(
      ti.access,
      'Installation holder',
      {
        certificateNumber: 'INSTALL-' + suffix,
        ...(seeded
          ? {
              holderName: 'Installation Holder',
              trainingStart: '2026-01-01',
              trainingEnd: '2026-01-02',
              trainingDays: 2,
              teachingHours: 16,
              placeOfIssue: 'Bratislava',
              issueDate: new Date().toISOString().slice(0, 10),
              signatory: 'Installation signer',
            }
          : {}),
      },
      type,
    );
  let offer;
  for (let attempt = 0; ; attempt++) {
    try {
      offer = await createOffer();
      break;
    } catch (error) {
      const reason = (error as { response?: { data?: { reason?: string } } }).response?.data
        ?.reason;
      // Each refusal queues the onboarding again: ask every 10 s, for up to 15 minutes.
      if (reason !== 'NotOnboarded' || attempt >= 90) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  const reference = new URL(offer.offer_uri).searchParams.get('credential_offer_uri')!;
  assert.ok(reference.startsWith(origin + '/'));
  const offered = await wallet.fetchJson(reference);
  const metadata = await wallet.getJson(
    offered.credential_issuer + '/.well-known/openid-credential-issuer',
  );
  // OpenID4VCI 1.0: the PIN is the transaction code; each key proof answers a fresh c_nonce
  // from the Nonce Endpoint and, after anonymous pre-authorized access, names no iss.
  const discovery = await wallet.getJson(
    metadata.authorization_servers[0] + '/.well-known/oauth-authorization-server',
  );
  assert.equal(metadata.credential_issuer, origin);
  const token = await wallet.postTokenRequest(
    discovery.token_endpoint,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code',
      'pre-authorized_code':
        offered.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'][
          'pre-authorized_code'
        ],
      tx_code: offer.pin,
    }).toString(),
  );
  const holder = await verificationHolder();
  const proof = async () =>
    new SignJWT({ nonce: (await wallet.postNonceRequest(metadata.nonce_endpoint)).c_nonce })
      .setProtectedHeader({ alg: 'ES256', typ: 'openid4vci-proof+jwt', kid: holder.did })
      .setAudience(origin)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(holder.privateKey);
  const credentialBody = async (jwt?: string) => ({
    credential_configuration_id: offered.credential_configuration_ids[0],
    proofs: { jwt: [jwt ?? (await proof())] },
  });
  const forged = await proof();
  await assert.rejects(
    wallet.postCredentialRequest(
      metadata.credential_endpoint,
      token.access_token,
      JSON.stringify(await credentialBody(forged.slice(0, -5) + 'wrong')),
    ),
  );
  const collected = await wallet.postCredentialRequest(
    metadata.credential_endpoint,
    token.access_token,
    JSON.stringify(await credentialBody()),
  );
  const issued = collected.credentials?.[0]?.credential as string;
  assert.ok(issued);
  const split = wallet.split(issued);
  assert.equal(
    wallet.reveal(decodeJwt(split.jwt), split.disclosures).vc.credentialSubject.certificateNumber,
    'INSTALL-' + suffix,
  );
  await assert.rejects(
    wallet.postCredentialRequest(
      metadata.credential_endpoint,
      token.access_token,
      JSON.stringify(await credentialBody()),
    ),
  );

  // The ordinary runtime's own worker must register the exact collected credential.
  let verified;
  for (let i = 0; i < 40; i++) {
    const offeredVp = await api('/registry/presentation-offer/', ti.access);
    const uri = new URL(offeredVp.offer_uri).searchParams.get('request_uri')!;
    const requested = await wallet.fetchRequestObject(uri);
    const request = decodeJwt(requested);
    // OpenID4VP 1.0: a DCQL query; the vp_token answers it by its query id.
    const queryId = (request.dcql_query as { credentials: { id: string }[] }).credentials[0].id;
    const vp = await new SignJWT({
      nonce: request.nonce,
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holder.did,
        verifiableCredential: [issued],
      },
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: holder.did })
      .setIssuer(holder.did)
      .setSubject(holder.did)
      .setAudience(request.client_id as string)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(holder.privateKey);
    await fetch(request.response_uri as string, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        state: request.state as string,
        vp_token: JSON.stringify({ [queryId]: [vp] }),
      }),
    });
    verified = await api('/registry/presentation-result/?state=' + offeredVp.state, ti.access);
    if (verified.outcome === 'VALID') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(verified.outcome, 'VALID', JSON.stringify(verified));

  const backup = await actualBackupWallet();
  backup.setOrigin(origin);
  const phrase =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const identity = backup.identityKeyOf(phrase);
  await backup.restoreWallet(phrase, '1234');
  await backup.setKeychainDataObject({
    ...(await backup.getKeychainDataObject()),
    credentials: [{ id: offer.credential_id, credential: issued }],
  });
  await backup.markBackupReady();
  assert.equal(await backup.uploadBackup(), 'uploaded');
  const saved = await backup.downloadBackup(backup.backupKeys(identity));
  assert.equal(saved.content.credentials[0].credential, issued);
  await backup.resetGenericPassword();
  backup.SessionPin.clear();
  await backup.restoreWallet(phrase, '5678');
  await backup.mergeBackup(saved);
  assert.equal((await backup.getKeychainDataObject()).credentials[0].credential, issued);

  // Redis-backed holder exchange consumes an actual Wallet one-shot response.
  const exchangeWallet = await actualHolderWallet({
    host: '0.0.0.0',
    publicHost: new URL(origin).hostname,
  });
  try {
    const exchange = exchangeWallet.create();
    const request = await api(
      '/registry/presentation-exchange/',
      ti.access,
      {
        invitation: exchange.invitation,
        fields: { mandatory: ['certificateNumber'], optional: [] },
      },
      201,
    );
    const state = request.state;
    const headers = { authorization: 'Bearer ' + ti.access };
    const polling = fetch(origin + '/registry/presentation-result/?state=' + state, { headers });
    for (let i = 0; i < 100 && !exchange.query; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(exchange.query);
    const query = exchange.query;
    const vp = await new SignJWT({
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holder.did,
        verifiableCredential: [issued],
      },
      nonce: query.challenge,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: holder.did })
      .setIssuer(holder.did)
      .setSubject(holder.did)
      .setAudience(query.domain)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(holder.privateKey);
    exchange.answer({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiablePresentation',
      id: 'data:application/jwt,' + vp,
    });
    const response = await polling;
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.outcome, 'VALID', JSON.stringify(result));
  } finally {
    await exchangeWallet.close();
  }

  if (process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE)
    await writeFile(
      process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE,
      JSON.stringify({
        origin,
        username,
        password,
        tiName,
        taoName,
        type,
        credential: issued,
        certificate_id: offer.certificate_id,
      }),
      { mode: 0o600 },
    );
  console.log(
    'Ordinary image API: bootstrap login, schema/hierarchy, actual Wallet registration/catalog/offer/discovery/token/collection, invalid proof/replay, background ledger delivery, verification, backup decrypt/restore and holder exchange passed.',
  );
} catch (error) {
  const failure = error as {
    response?: { status?: number; data?: unknown };
    config?: { method?: string; url?: string };
    message?: string;
    stack?: string;
  };
  console.error(
    'Installation check failed:',
    failure.config ? `${failure.config.method?.toUpperCase()} ${failure.config.url}` : '',
    failure.response?.status ?? '',
    failure.response?.data ?? failure.message,
    failure.config ? '' : failure.stack?.split('\n').slice(1, 4).join(' / '),
  );
  process.exitCode = 1;
}
