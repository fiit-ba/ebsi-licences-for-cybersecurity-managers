import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import QRCode from 'qrcode';

/**
 * Read synthetic holder/party material from the owned fixture, never an application endpoint.
 * @returns Synthetic credential and EC keys; no real provider or native Wallet state.
 */
async function material() {
  return JSON.parse(
    await readFile(
      `/tmp/atest-verification-browser-${process.env.BACK_OFFICE_VERIFICATION_TEST_PORT ?? 8794}.json`,
      'utf8',
    ),
  );
}

/**
 * Authenticate through the unchanged sign-in screen and open the verification workflow.
 * @param page - Headless Chromium page.
 * @returns Completion after the existing verify screen is usable.
 */
async function login(page: Page) {
  await page.goto('/verify');
  await page.locator('#u').fill('browser.verification.verifier');
  await page.locator('#p').fill('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
  await page.locator('button[type=submit]').click();
  await expect(
    page.getByRole('button', { name: 'Požiadať o predloženie', exact: true }),
  ).toBeVisible();
}

/**
 * Send an actual browser-origin verifier request with the existing authentication contract.
 * @param page - Browser page.
 * @param path - Existing API or public request-object URL.
 * @param method - HTTP verb.
 * @param body - Optional JSON body.
 * @param headers - Optional party/mobile authorization headers.
 * @returns Actual response status and JSON, without interception.
 */
async function api(
  page: Page,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return page.evaluate(
    async ({ path, method, body, headers }) => {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body, headers },
  );
}

/**
 * Sign the actual Wallet's JWT-VP claim set inside Chromium and send it to the response URI
 * (OpenID4VP 1.0 direct_post).
 * @param page - Browser page providing WebCrypto.
 * @param uri - Existing openid request_uri link.
 * @param token - Protocol-shaped credential with its disclosures.
 * @param changes - Optional wrong audience/nonce/time for refusal scenarios.
 * @returns Real callback response and decoded request claims.
 */
async function present(
  page: Page,
  uri: string,
  token: string,
  changes: Record<string, unknown> = {},
) {
  const fixture = await material();
  return page.evaluate(
    async ({ uri, token, changes, privateJwk, holder }) => {
      const url = new URL(uri).searchParams.get('request_uri')!;
      const object = await (await fetch(url)).text();
      const request = JSON.parse(atob(object.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const encode = (value: string) =>
        btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: holder,
        sub: holder,
        aud: request.client_id,
        nonce: request.nonce,
        state: request.state,
        iat: now,
        nbf: now,
        exp: now + 900,
        vp: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiablePresentation'],
          holder,
          verifiableCredential: [token],
        },
        ...changes,
      };
      const input =
        encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: holder })) +
        '.' +
        encode(JSON.stringify(claims));
      const key = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(input),
      );
      const vp = input + '.' + encode(String.fromCharCode(...new Uint8Array(signature)));
      // OpenID4VP 1.0: the vp_token answers the request's DCQL query by its id.
      const queryId = request.dcql_query.credentials[0].id;
      const response = await fetch(request.response_uri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          state: request.state,
          vp_token: JSON.stringify({ [queryId]: [vp] }),
        }),
      });
      return { status: response.status, request };
    },
    { uri, token, changes, privateJwk: fixture.privateJwk, holder: fixture.holder },
  );
}

test('console QR, browser-signed presentation, result evidence and server retention', async ({
  page,
}) => {
  await login(page);
  const reply = page.waitForResponse((response) =>
    response.url().includes('/registry/presentation-offer/'),
  );
  await page.getByRole('button', { name: 'Požiadať o predloženie', exact: true }).click();
  const offer = await (await reply).json();
  await expect(page.getByAltText('QR kód so žiadosťou o predloženie')).toBeVisible();
  const fixture = await material();
  expect((await present(page, offer.offer_uri, fixture.token)).status).toBe(200);
  await expect(
    page
      .locator('b')
      .filter({ hasText: /^VALID$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible();
  await expect(page.getByText('Akreditačný reťazec (TIR)', { exact: true })).toBeVisible();
  const bearer = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  const database = new pg.Pool();
  try {
    expect(process.env.PGDATABASE).toBe('atest_back_office_test');
    await database.query('UPDATE presentation_results SET attributes_until=now() WHERE state=$1', [
      offer.state,
    ]);
    const result = await api(
      page,
      '/api-backend/registry/presentation-result/?state=' + offer.state,
      'GET',
      undefined,
      { authorization: 'Bearer ' + bearer },
    );
    expect(result.body.credentials[0].attributes).toBeNull();
    await expect
      .poll(
        async () =>
          (
            await database.query(
              'SELECT attributes_encrypted IS NULL AS purged FROM presentation_results WHERE state=$1',
              [offer.state],
            )
          ).rows[0].purged,
      )
      .toBe(true);
  } finally {
    await database.end();
  }
});

test('the console stops waiting and says so when the holder declines in the wallet', async ({
  page,
}) => {
  await login(page);
  const reply = page.waitForResponse((response) =>
    response.url().includes('/registry/presentation-offer/'),
  );
  await page.getByRole('button', { name: 'Požiadať o predloženie', exact: true }).click();
  const offer = await (await reply).json();
  await expect(page.getByAltText('QR kód so žiadosťou o predloženie')).toBeVisible();
  // The wallet reads the request, then answers with the OpenID4VP error response.
  const status = await page.evaluate(async (uri) => {
    const url = new URL(uri).searchParams.get('request_uri')!;
    const object = await (await fetch(url)).text();
    const request = JSON.parse(atob(object.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const response = await fetch(request.response_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ error: 'access_denied', state: request.state }),
    });
    return response.status;
  }, offer.offer_uri);
  expect(status).toBe(200);
  await expect(
    page.getByText('Držiteľ žiadosť v peňaženke odmietol.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByAltText('QR kód so žiadosťou o predloženie')).toHaveCount(0);
});

test('console keeps a suspended decision and its failed standing condition', async ({ page }) => {
  await login(page);
  const reply = page.waitForResponse((response) =>
    response.url().includes('/registry/presentation-offer/'),
  );
  await page.getByRole('button', { name: 'Požiadať o predloženie', exact: true }).click();
  const offer = await (await reply).json();
  expect((await present(page, offer.offer_uri, (await material()).suspended)).status).toBe(400);
  await expect(
    page
      .locator('b')
      .filter({ hasText: /^SUSPENDED$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible();
});

test('existing holder QR paste connects to actual Wallet exchange code and renders evidence', async ({
  page,
}) => {
  await login(page);
  await page.locator('#holder-invitation').fill(JSON.stringify((await material()).invitation));
  await page.getByRole('button', { name: 'Pripojiť sa k peňaženke', exact: true }).click();
  await expect(
    page
      .locator('b')
      .filter({ hasText: /^VALID$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible();
});

test('a photo of the holder QR is decoded under the console CSP; other pictures are explained', async ({
  page,
}) => {
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/.test(message.text()) && /blob:/.test(message.text()))
      blocked.push(message.text());
  });
  await login(page);
  const picker = page.locator('input[type=file]');
  // Another type, so the backend refuses it and the fixture's one-time exchange stays unused.
  const invitation = JSON.stringify({ ...(await material()).invitation, type: 'Other' });
  const photo = await QRCode.toBuffer(invitation, { type: 'png', margin: 4, scale: 6 });
  await picker.setInputFiles({ name: 'holder-qr.png', mimeType: 'image/png', buffer: photo });
  await expect(page.locator('#holder-invitation')).toHaveValue(invitation);
  await expect(page.getByText('Obrázok sa nepodarilo načítať.', { exact: true })).toHaveCount(0);

  const blank = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await picker.setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(page.getByText('Na obrázku sa nenašiel QR kód.', { exact: true })).toBeVisible();
  await picker.setInputFiles({
    name: 'note.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText('Obrázok sa nepodarilo načítať.', { exact: true })).toBeVisible();
  expect(blocked).toEqual([]);
});

test('mobile and external clients use their own result authorization and source response formats', async ({
  page,
}) => {
  await page.goto('/verify');
  const fixture = await material();
  const mobile = await api(page, '/verifier/v1/mobile/presentation-requests/', 'POST', {});
  expect(mobile.status).toBe(201);
  expect((await present(page, mobile.body.request_uri, fixture.token)).status).toBe(200);
  const mobilePath = '/verifier/v1/mobile/presentation-requests/' + mobile.body.state + '/';
  expect((await api(page, mobilePath)).status).toBe(404);
  const result = await api(page, mobilePath, 'GET', undefined, {
    'X-PLR-Read-Token': mobile.body.read_token,
  });
  expect(result.body.outcome).toBe('VALID');
  expect(result.body.credentials[0].attributes.holderName).toBe('Ada Lovelace');
  const headers = { authorization: 'ApiKey ' + fixture.partyKey };
  const party = await api(page, '/verifier/v1/presentation-requests/', 'POST', {}, headers);
  expect(party.status).toBe(201);
  expect((await present(page, party.body.request_uri, fixture.token)).status).toBe(200);
  const path = '/verifier/v1/presentation-requests/' + party.body.state + '/';
  expect(
    (await api(page, path, 'GET', undefined, { authorization: 'ApiKey ' + fixture.otherPartyKey }))
      .status,
  ).toBe(404);
  const completed = await api(page, path, 'GET', undefined, headers);
  expect(completed.body.result).toBe('VALID');
  expect(completed.body.acceptable).toBe(true);
  expect(completed.body.presented_at).toBeTruthy();
  const direct = await api(
    page,
    '/verifier/v1/credentials/verify/',
    'POST',
    { credential: fixture.token },
    headers,
  );
  expect(direct.body.scope).toBe('credential');
  expect(direct.body.checks.holder_bound).toBeNull();
});
