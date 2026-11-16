import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import pg from 'pg';

const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';

/** One-time handoff returned by the unchanged issuance clients. */
interface Offer {
  credential_id: string;
  certificate_id: string;
  offer_uri: string;
  pin: string;
  qr?: string;
}

/**
 * Send real consumer JSON requests from headless Chromium without route interception.
 * @param page - Current browser page.
 * @param path - API path or absolute offer/metadata URL.
 * @param method - HTTP method.
 * @param data - Optional JSON body.
 * @param token - Optional operator or issuance bearer.
 * @returns The actual HTTP status and parsed response.
 */
async function json(page: Page, path: string, method = 'GET', data?: unknown, token?: string) {
  return page.evaluate(
    async ({ path, method, data, token }) => {
      const response = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, data, token },
  );
}

/**
 * Authenticate using the organization Wallet's existing request contract.
 * @param page - Browser page holding the actual same-origin API context.
 * @param suffix - Synthetic TI, sibling or observer account suffix.
 * @returns The access JWT from the real identity API.
 */
async function login(page: Page, suffix = 'ti') {
  await page.goto('/issue');
  const result = await json(page, '/api-backend/api/api-token-auth', 'POST', {
    username: 'browser.issuance.' + suffix,
    password,
  });
  expect(result.status).toBe(200);
  return result.body.access as string;
}

/**
 * Create a certificate with the organization Wallet's QR request.
 * @param page - Browser page.
 * @param token - TI access bearer.
 * @param number - Unique certificate number.
 * @returns The actual credential handoff and server-generated QR.
 */
async function walletIssue(page: Page, token: string, number: string): Promise<Offer> {
  const scheme = await json(
    page,
    '/api-backend/registry/certificate-scheme/',
    'GET',
    undefined,
    token,
  );
  expect(scheme.status).toBe(200);
  const issued = await json(
    page,
    '/api-backend/registry/issue/',
    'POST',
    {
      holder_reference: 'wallet-file',
      credential_type: scheme.body.schemas[0].credential_type,
      claims: { certificateNumber: number, holderName: 'Wallet Holder' },
      qr: true,
    },
    token,
  );
  expect(issued.status).toBe(201);
  expect(issued.body.qr).toMatch(/^data:image\/png;base64,/);
  return issued.body;
}

/**
 * Follow offer and discovery URLs, then exchange the PIN as the transaction code, as the holder
 * Wallet does (OpenID4VCI 1.0).
 * @param page - Browser page.
 * @param handoff - Registered certificate's offer and separate PIN.
 * @param pin - Candidate PIN, defaulting to the correct handoff secret.
 * @returns Discovery, offered credential and actual token response.
 */
async function exchange(page: Page, handoff: Offer, pin = handoff.pin) {
  const reference = new URL(handoff.offer_uri).searchParams.get('credential_offer_uri')!;
  const offer = await json(page, reference);
  expect(offer.status).toBe(200);
  const metadata = (
    await json(page, offer.body.credential_issuer + '/.well-known/openid-credential-issuer')
  ).body;
  const authorization = (
    await json(page, metadata.authorization_servers[0] + '/.well-known/oauth-authorization-server')
  ).body;
  const result = await page.evaluate(
    async ({ endpoint, code, pin }) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code',
          'pre-authorized_code': code,
          tx_code: pin,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    {
      endpoint: authorization.token_endpoint,
      code: offer.body.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'][
        'pre-authorized_code'
      ],
      pin,
    },
  );
  return { metadata, offer: offer.body, result };
}

/**
 * Sign the Wallet's P-256 did:key proof in the browser, preserving its holder across retries.
 * Access came anonymously with a pre-authorized code, so the proof names no `iss`.
 * @param page - Browser holding the ephemeral per-issuer key.
 * @param nonce - c_nonce from the Nonce Endpoint.
 * @param audience - Metadata credential issuer.
 * @returns The signed key proof JWT.
 */
async function holderProof(page: Page, nonce: string, audience: string) {
  return page.evaluate(
    async ({ nonce, audience }) => {
      const scope = globalThis as typeof globalThis & {
        issuanceHolder?: { pair: CryptoKeyPair; did: string };
      };
      const encode = (value: unknown) =>
        btoa(typeof value === 'string' ? value : JSON.stringify(value))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replaceAll('=', '');
      if (!scope.issuanceHolder) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
          'sign',
          'verify',
        ]);
        const { crv, kty, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
        const bytes = new Uint8Array([
          0xd1,
          0xd6,
          3,
          ...new TextEncoder().encode(JSON.stringify({ crv, kty, x, y })),
        ]);
        let value = BigInt(
          '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
        );
        let base58 = '';
        const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        while (value) {
          base58 = alphabet[Number(value % 58n)] + base58;
          value /= 58n;
        }
        scope.issuanceHolder = { pair, did: 'did:key:z' + base58 };
      }
      const { pair, did } = scope.issuanceHolder;
      const input =
        encode({ typ: 'openid4vci-proof+jwt', alg: 'ES256', kid: did + '#' + did.slice(8) }) +
        '.' +
        encode({
          iat: Date.now() / 1000,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce,
        });
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(input),
      );
      return input + '.' + encode(String.fromCharCode(...new Uint8Array(signature)));
    },
    { nonce, audience },
  );
}

/**
 * Request the offered credential using a browser-signed holder proof.
 * @param page - Browser page.
 * @param session - Actual offer, metadata and token result.
 * @param nonce - Optional incorrect nonce for refusal checks; a fresh one from the Nonce
 * Endpoint by default.
 * @returns Actual collection response from the production HTTP handler.
 */
async function collect(page: Page, session: Awaited<ReturnType<typeof exchange>>, nonce?: string) {
  const value = nonce ?? (await json(page, session.metadata.nonce_endpoint, 'POST')).body.c_nonce;
  return json(
    page,
    session.metadata.credential_endpoint,
    'POST',
    {
      credential_configuration_id: session.offer.credential_configuration_ids[0],
      proofs: { jwt: [await holderProof(page, value, session.metadata.credential_issuer)] },
    },
    session.result.body.access_token,
  );
}

/**
 * Apply a bounded test-only fault or expiry change to the isolated fixture database.
 * @param sql - Trusted test SQL.
 * @param values - Bound synthetic identifiers or fault settings.
 * @returns Completion after the single fixture mutation and closed connection.
 */
async function change(sql: string, values: unknown[] = []) {
  expect(process.env.PGDATABASE).toBe('atest_back_office_test');
  const database = new pg.Pool();
  try {
    await database.query(sql, values);
  } finally {
    await database.end();
  }
}

test('Back Office form creates an offer; holder collects with metadata, PIN and browser P-256 proof', async ({
  page,
}) => {
  await page.goto('/issue');
  await page.getByLabel('Používateľ', { exact: true }).fill('browser.issuance.ti');
  await page.getByLabel('Heslo', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByLabel('Interná referencia držiteľa', { exact: true }).fill('browser-file');
  await page.getByLabel('Číslo osvedčenia', { exact: true }).fill('BROWSER-FORM-1');
  await page.getByLabel('Meno držiteľa', { exact: true }).fill('Browser Holder');
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/registry/issue/') && response.request().method() === 'POST',
  );
  await page.locator('.issue-panel button[type=submit]').click();
  const issued = await response;
  expect(issued.status()).toBe(201);
  const handoff = await issued.json();
  await expect(page.locator('.offer-pin')).toHaveText(handoff.pin);
  await expect(page.locator('.offer-qr')).toBeVisible();
  const session = await exchange(page, handoff);
  expect(session.result.status).toBe(200);
  const credential = await collect(page, session);
  expect(credential.status).toBe(200);
  const payload = JSON.parse(
    Buffer.from(credential.body.credentials[0].credential.split('.')[1], 'base64url').toString(),
  );
  expect(payload.jti).not.toBe(handoff.credential_id);
  expect(payload.vc.credentialSubject.certificateNumber).toBe('BROWSER-FORM-1');
  expect(payload.sub).toMatch(/^did:key:z/);
  expect(payload.vc.credentialStatus[0].type).toBe('PlrLedgerStatusEntry');
  expect((await collect(page, session)).status).toBe(401);
});

test('organization Wallet creation, invalid PIN/proof, expiry and replacement offer use the actual API', async ({
  page,
}) => {
  const token = await login(page);
  const handoff = await walletIssue(page, token, 'WALLET-ISSUE-1');
  const wrong = await exchange(page, handoff, handoff.pin === '000000' ? '111111' : '000000');
  expect(wrong.result.body.error).toBe('invalid_grant');
  await change('UPDATE credential_offers SET expires_at=now() WHERE certificate_id=$1', [
    handoff.certificate_id,
  ]);
  const oldReference = new URL(handoff.offer_uri).searchParams.get('credential_offer_uri')!;
  expect((await json(page, oldReference)).status).toBe(404);
  const renewed = await json(
    page,
    '/api-backend/registry/reoffer/',
    'POST',
    { credential_id: handoff.credential_id },
    token,
  );
  expect(renewed.status).toBe(200);
  const session = await exchange(page, renewed.body);
  expect(session.result.status).toBe(200);
  expect((await collect(page, session, 'wrong-nonce')).body.error).toBe('invalid_nonce');
  expect((await collect(page, session)).status).toBe(200);
  const again = await json(
    page,
    '/api-backend/registry/reoffer/',
    'POST',
    { credential_id: handoff.credential_id },
    token,
  );
  expect(again.status).toBe(409);
  expect(again.body.reason).toBe('OfferAlreadyRedeemed');
});

test('lost signing and ledger responses recover for the same holder without duplicate collection', async ({
  page,
}) => {
  const token = await login(page);
  for (const fault of ['lost-sign', 'lost-ledger']) {
    const handoff = await walletIssue(page, token, 'BROWSER-' + fault);
    const session = await exchange(page, handoff);
    await change('UPDATE issuance_browser_faults SET mode=$1', [fault]);
    const first = await collect(page, session);
    expect(first.status).toBe(fault === 'lost-sign' ? 503 : 200);
    if (fault === 'lost-sign') expect((await collect(page, session)).status).toBe(200);
    else expect(first.body.credentials[0].credential).toBeTruthy();
    await expect
      .poll(async () => {
        const list = await json(
          page,
          '/api-backend/registry/certificates/?q=' + encodeURIComponent('BROWSER-' + fault),
          'GET',
          undefined,
          token,
        );
        return list.body.results[0]?.state;
      })
      .toBe('active');
    expect((await collect(page, session)).status).toBe(401);
  }
});

test('issuer role, expired accreditation and foreign ownership refuse browser consumer requests', async ({
  page,
}) => {
  const token = await login(page);
  const handoff = await walletIssue(page, token, 'BROWSER-ACCESS');
  const observer = await login(page, 'observer');
  expect(
    (
      await json(
        page,
        '/api-backend/registry/issue/',
        'POST',
        { holder_reference: 'ref', claims: { n: '1' } },
        observer,
      )
    ).status,
  ).toBe(403);
  // Ensure sibling onboarding through its own ordinary issuance path first.
  const sibling = await login(page, 'other');
  await walletIssue(page, sibling, 'BROWSER-SIBLING');
  const foreign = await json(
    page,
    '/api-backend/registry/reoffer/',
    'POST',
    { credential_id: handoff.credential_id },
    sibling,
  );
  expect(foreign.status).toBe(403);
  expect(foreign.body.reason).toBe('NotYours');
  await change(
    "UPDATE accredited_organizations SET accredited_until=now() WHERE account_id=(SELECT id FROM operator_accounts WHERE username='browser.issuance.ti')",
  );
  const ended = await json(
    page,
    '/api-backend/registry/issue/',
    'POST',
    { holder_reference: 'ref', claims: { certificateNumber: 'ENDED', holderName: 'Holder' } },
    token,
  );
  expect(ended.status).toBe(403);
  expect(ended.body.reason).toBe('AccreditationExpired');
});
