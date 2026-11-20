import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import pg from 'pg';
import { organizationSuiteDids } from '../../server/accreditation/fixtures/organization-wallets.ts';

const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
const credentialType = 'OrganizationBrowserCredential';

/**
 * Sign in through the real existing operator form at the accreditation route.
 * @param page - Isolated browser page.
 * @param username - Fixture account or account created during the registration workflow.
 * @returns Completion after the authenticated console shell is visible.
 */
async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/accreditation');
  await page.getByLabel('Používateľ', { exact: true }).fill(username);
  await page.getByLabel('Heslo', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

test('RootTAO selects a TAO, its account registers, and the existing wallet API registers a delegated TI', async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500)
      failures.push(response.status() + ' ' + new URL(response.url()).pathname);
  });
  await signIn(page, 'browser.organization.root');
  await expect(
    page.getByRole('checkbox', { name: 'Organizačné oprávnenie', exact: true }),
  ).toBeChecked();
  await page
    .getByLabel('Názov organizácie', { exact: true })
    .fill('Browser Accreditation Authority');
  // The TAO brings its own DID, which its wallet registered in the DID Registry.
  await page.getByLabel('DID organizácie', { exact: true }).fill(organizationSuiteDids.tao);
  await page
    .getByLabel('Kontaktný e-mail (voliteľné)', { exact: true })
    .fill('tao.browser@example.test');
  const selected = page.waitForResponse(
    (response) =>
      response.url().endsWith('/registry/trust-chain/select/') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Vybrať a vytvoriť pozvánku', exact: true }).click();
  const taoSelection = await (await selected).json();
  await expect(page.locator('.code-emphasis')).toHaveText(taoSelection.invitation);
  await page.getByRole('button', { name: 'Odhlásiť', exact: true }).click();
  await page.getByRole('tab', { name: 'Registrácia', exact: true }).click();
  await page.getByLabel('Pozvánka', { exact: true }).fill(taoSelection.invitation);
  await page.getByLabel('Používateľské meno', { exact: true }).fill('browser.organization.tao');
  await page.getByLabel('Heslo', { exact: true }).fill('password');
  await page.getByLabel('Zopakujte heslo', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Registrovať', exact: true }).click();
  await expect(page.locator('.notice.err')).toContainText('Heslo musí mať 15 až 128 znakov.');
  await page.getByLabel('Heslo', { exact: true }).fill(password);
  await page.getByLabel('Zopakujte heslo', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Registrovať', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
  await page.getByLabel('Heslo', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vybrať TI', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Organizačné oprávnenie', exact: true }),
  ).toBeChecked();
  await page.getByLabel('Názov organizácie', { exact: true }).fill('Browser Training Issuer');
  await page.getByLabel('DID organizácie', { exact: true }).fill(organizationSuiteDids.ti);
  await page
    .getByLabel('Akreditácia platí do', { exact: true })
    .fill(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
  const tiSelected = page.waitForResponse(
    (response) =>
      response.url().endsWith('/registry/trust-chain/select/') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Vybrať a vytvoriť pozvánku', exact: true }).click();
  const tiSelection = await (await tiSelected).json();
  await expect(page.locator('.code-emphasis')).toHaveText(tiSelection.invitation);

  // These are the requests made by holder-wallet's organization client, with no API interception.
  const registered = await request.post('/api-backend/organizations/v1/registrations/', {
    data: {
      invitation: tiSelection.invitation,
      username: 'browser.organization.ti',
      password,
      kind: 'ti',
    },
  });
  expect(registered.status()).toBe(201);
  expect(await registered.json()).toEqual({
    organization: 'Browser Training Issuer',
    kind: 'ti',
    username: 'browser.organization.ti',
  });
  const login = await request.post('/api-backend/api/api-token-auth', {
    data: { username: 'browser.organization.ti', password },
  });
  expect(login.status()).toBe(200);
  const headers = { authorization: 'Bearer ' + (await login.json()).access };
  const profile = await (await request.get('/api-backend/registry/me/', { headers })).json();
  expect(profile.roles).toEqual(['plr_issuer', 'plr_status_manager', 'plr_verifier']);
  expect(profile.organization).toBe('Browser Training Issuer');
  expect(profile.accreditation_ended).toBe(false);
  let schemes = await (
    await request.get('/api-backend/registry/certificate-scheme/', { headers })
  ).json();
  expect(
    schemes.schemas.map((schema: { credential_type: string }) => schema.credential_type),
  ).toEqual([credentialType]);
  await page.reload();
  await expect(page.getByText('registrovaná', { exact: true })).toBeVisible();
  const pendingIssuer = page.getByText('v EBSI zatiaľ nie je nastavená ako vydavateľ', {
    exact: true,
  });
  // The TI is an issuer only once it stored its accreditation in EBSI with its own wallet.
  await expect(pendingIssuer).toBeVisible();
  await expect(page.getByText(organizationSuiteDids.ti, { exact: true })).toBeVisible();
  // Its TAO checks it in EBSI's registries: no accreditation stored, and none issued yet, as
  // the TAO has not stored its own.
  await page.getByRole('button', { name: 'EBSI', exact: true }).click();
  if (process.env.BACK_OFFICE_TEST_EBSI_URL) {
    await expect(page.getByText('čaká na zápis do TIR', { exact: true })).toBeVisible();
    await expect(page.getByText('V DID dokumente', { exact: true })).toBeVisible();
  } else
    await expect(
      page.getByText('Registre EBSI nie sú v tejto inštalácii nastavené.', { exact: true }),
    ).toBeVisible();
  await page.getByRole('button', { name: 'EBSI', exact: true }).click();
  await page.getByRole('button', { name: 'Akreditácia', exact: true }).click();
  await page.getByRole('button', { name: 'Ukončiť teraz', exact: true }).click();
  await page.getByRole('button', { name: 'Ukončiť akreditáciu', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api-backend/registry/me/', { headers })).json())
          .accreditation_ended,
    )
    .toBe(true);
  const taoToken = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  const renewed = await request.post('/api-backend/registry/trust-chain/lifespan/', {
    headers: { authorization: 'Bearer ' + taoToken },
    data: {
      organization_id: tiSelection.organization_id,
      accredited_until: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  expect(renewed.status()).toBe(200);
  expect(
    (await (await request.get('/api-backend/registry/me/', { headers })).json())
      .accreditation_ended,
  ).toBe(false);
  await page.getByRole('button', { name: 'Odhlásiť', exact: true }).click();
  await signIn(page, 'browser.organization.root');
  const token = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  const removed = await request.post('/api-backend/registry/trust-chain/schemas/', {
    headers: { authorization: 'Bearer ' + token },
    data: { organization_id: taoSelection.organization_id, schemas: [] },
  });
  expect(removed.status()).toBe(200);
  schemes = await (
    await request.get('/api-backend/registry/certificate-scheme/', { headers })
  ).json();
  expect(schemes.schemas).toEqual([]);
  expect(
    (
      await request.post('/api-backend/organizations/v1/registrations/', {
        data: { invitation: tiSelection.invitation, username: 'replay', password, kind: 'ti' },
      })
    ).status(),
  ).toBe(404);
  await page.reload();
  await page.getByRole('button', { name: 'Odňať', exact: true }).click();
  await page.locator('#revoke-understood').check();
  await page.getByRole('button', { name: 'Odňať akreditáciu', exact: true }).last().click();
  await expect(page.getByText('akreditácia odňatá', { exact: true })).toBeVisible();
  expect((await request.get('/api-backend/registry/me/', { headers })).status()).toBe(401);
  const database = new pg.Pool();
  try {
    expect(
      (
        await database.query(
          'SELECT 1 FROM operator_password_resets r JOIN operator_accounts a ON a.id=r.account_id WHERE a.username LIKE $1',
          ['browser.organization.%'],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await database.end();
  }
  expect(failures).toEqual([]);
});

test('the Schémy tab lists the schemas read from the registry, and nobody defines one here', async ({
  page,
  request,
}) => {
  await signIn(page, 'browser.organization.root');
  await page.goto('/schemas');
  const row = page
    .getByRole('row')
    .filter({ has: page.getByText('OrganizationBrowserCredential', { exact: true }) });
  await expect(row.getByText('v TSR', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Atribúty', exact: true }).click();
  await expect(page.getByText(/schemas\/organization-browser-fixture$/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'licenceNumber', exact: true })).toBeVisible();
  for (const name of ['Nová schéma', 'Upraviť', 'Vyradiť'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  const token = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  for (const path of [
    '/registry/schemas/',
    '/registry/schemas/confirm/',
    '/registry/schemas/retire/',
  ]) {
    const refused = await request.post('/api-backend' + path, {
      headers: { authorization: 'Bearer ' + token },
      data: { credential_type: 'BrowserPublishedCertificate' },
    });
    expect(refused.status()).toBe(404);
  }
});

test('a superuser with the RootTAO role but no registered organization cannot select an organization', async ({
  page,
  request,
}) => {
  await signIn(page, 'browser.organization.observer');
  await expect(page.locator('.notice.err')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vybrať a vytvoriť pozvánku', exact: true }),
  ).toHaveCount(0);
  const token = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  const refused = await request.post('/api-backend/registry/trust-chain/select/', {
    headers: { authorization: 'Bearer ' + token },
    data: { name: 'Forbidden', did: organizationSuiteDids.tao },
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).reason).toBe('NoOrganization');
});
