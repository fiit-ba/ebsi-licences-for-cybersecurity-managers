import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import pg from 'pg';
import { SignJWT } from 'jose';
const initialPassword = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';

/**
 * Authenticate an administration fixture through the real browser login form.
 * @param page - Isolated browser page.
 * @param username - Synthetic staff account seeded in the disposable database.
 * @returns Completion after the live administration heading is visible.
 */
async function signInStaff(page: Page, username: string): Promise<void> {
  await page.goto('/admin/auth/user/');
  await page.getByLabel('Používateľ', { exact: true }).fill(username);
  await page.getByLabel('Heslo', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Správa účtov', exact: true })).toBeVisible();
}

test('browser signs in with a newly created account against the real API', async ({
  page,
  request,
}) => {
  expect(process.env.PGDATABASE).toBe('atest_back_office_test');
  const database = new pg.Pool();
  const serverErrors: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api-backend/') && response.status() >= 500)
      serverErrors.push(`${response.status()} ${response.url()}`);
  });
  try {
    await page.goto('/');
    await page.getByLabel('Používateľ', { exact: true }).fill('live.identity');
    await page.getByLabel('Heslo', { exact: true }).fill('wrong');
    const wrongResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/api-token-auth') && response.status() === 401,
    );
    await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
    await wrongResponse;
    await expect(page.locator('.sidebar')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();

    const loginResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/api-token-auth') && response.status() === 200,
    );
    await page.getByLabel('Heslo', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
    const login = await (await loginResponse).json();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('a[data-tab="verify"]')).toBeVisible();
    await expect(page.locator('a[data-tab="issue"]')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBe(login.access);
    expect(await page.evaluate(() => sessionStorage.getItem('plr.refresh'))).toBeNull();
    const headers = { authorization: `Bearer ${login.access}` };
    const profile = await request.get('/api-backend/registry/me/', { headers });
    expect((await profile.json()).roles).toEqual(['plr_verifier']);
    expect(
      (
        await request.get('/api-backend/registry/me/', {
          headers: { authorization: `Bearer ${login.refresh}` },
        })
      ).status(),
    ).toBe(401);

    await page.getByRole('button', { name: 'Odhlásiť', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
    expect((await request.get('/api-backend/registry/me/', { headers })).status()).toBe(200);
    await page.getByLabel('Používateľ', { exact: true }).fill('live.identity');
    await page.getByLabel('Heslo', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
    await expect(page.locator('.sidebar')).toBeVisible();

    await database.query(`DELETE FROM operator_roles WHERE account_id = $1`, [login.user_id]);
    await page.reload();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('a[data-tab="verify"]')).toHaveCount(0);
    expect(
      (await (await request.get('/api-backend/registry/me/', { headers })).json()).roles,
    ).toEqual([]);

    await database.query('UPDATE operator_accounts SET active = false WHERE id = $1', [
      login.user_id,
    ]);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
    expect(serverErrors).toEqual([]);
    expect((await request.get('/api-backend/registry/me/', { headers })).status()).toBe(401);

    await database.query('UPDATE operator_accounts SET active = true WHERE id = $1', [
      login.user_id,
    ]);
    const expired = await new SignJWT({
      token_type: 'access',
      auth_version: 0,
      user_id: login.user_id,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('atest-back-office')
      .setSubject(String(login.user_id))
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1800)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 900)
      .sign(Buffer.from('live-identity-test-secret-'.repeat(2)));
    await page.evaluate((token) => sessionStorage.setItem('plr.token', token), expired);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
  } finally {
    await database.end();
  }
});

test('administration forms preserve self scope, explicit grants and sign-out after a self edit', async ({
  page,
  browser,
  request,
}) => {
  await signInStaff(page, 'live.staff.root');
  await page.getByRole('link', { name: 'Nový účet', exact: true }).click();
  await page.getByLabel('Používateľ', { exact: true }).fill('live.staff.created');
  await page.getByLabel('E-mail', { exact: true }).fill('created@example.test');
  await page.getByLabel('Meno', { exact: true }).fill('Created');
  await page.getByLabel('Priezvisko', { exact: true }).fill('Operator');
  await page.getByLabel('Nové heslo', { exact: true }).fill('browser-created-account-credential');
  await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill('different-credential');
  await page.getByLabel('plr_verifier', { exact: true }).check();
  await page.getByLabel('plr_governance_b', { exact: true }).check();
  await page.getByRole('button', { name: 'Uložiť účet', exact: true }).click();
  await expect(page.locator('.notice.err')).toContainText('Heslá sa nezhodujú.');
  await page
    .getByLabel('Potvrďte nové heslo', { exact: true })
    .fill('browser-created-account-credential');
  await page.getByRole('button', { name: 'Uložiť účet', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/auth\/user\/\d+\/change\/$/);
  await expect(page.getByLabel('Meno', { exact: true })).toHaveValue('Created');
  await expect(page.getByLabel('plr_verifier', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Nové heslo', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Používateľ', { exact: true })).toHaveValue('live.staff.created');

  const editorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
  });
  const viewerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    locale: 'sk-SK',
    timezoneId: 'Europe/Bratislava',
  });
  try {
    const editor = await editorContext.newPage();
    await signInStaff(editor, 'live.staff.editor');
    await expect(editor.locator('tbody tr')).toHaveCount(1);
    await editor.getByRole('link', { name: 'live.staff.editor', exact: true }).click();
    await expect(editor.getByLabel('Prístup do administrácie', { exact: true })).toBeDisabled();
    await expect(editor.getByLabel('Superuser', { exact: true })).toBeDisabled();
    await editor.getByLabel('Meno', { exact: true }).fill('Personal update');
    const edited = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/accounts/') && response.request().method() === 'POST',
    );
    await editor.getByRole('button', { name: 'Uložiť účet', exact: true }).click();
    expect((await edited).status()).toBe(200);
    await expect(editor.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
    expect(await editor.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();

    const viewer = await viewerContext.newPage();
    await signInStaff(viewer, 'live.staff.viewer');
    await expect(viewer.locator('tbody tr')).toHaveCount(1);
    await viewer.getByRole('link', { name: 'live.staff.viewer', exact: true }).click();
    await expect(viewer.getByLabel('Meno', { exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Uložiť účet', exact: true })).toHaveCount(0);
    const token = await viewer.evaluate(() => sessionStorage.getItem('plr.token'));
    const accountId = Number(new URL(viewer.url()).pathname.split('/')[4]);
    const denied = await request.post('/api-backend/admin/accounts/', {
      headers: { authorization: 'Bearer ' + token },
      data: {
        account_id: accountId,
        version: 0,
        username: 'promoted',
        email: 'viewer@example.test',
        is_superuser: true,
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await editorContext.close();
    await viewerContext.close();
  }
});

test('administrators manage groups and delete an unused account through the real API', async ({
  page,
}) => {
  await signInStaff(page, 'live.staff.root');
  await page.getByRole('link', { name: 'Skupiny', exact: true }).click();
  await page.getByRole('link', { name: 'Nová skupina', exact: true }).click();
  await page.getByLabel('Názov skupiny', { exact: true }).fill('browser.reviewers');
  await page.getByLabel('auth.view_user — Can view user', { exact: true }).check();
  await page.getByRole('button', { name: 'Uložiť skupinu', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/auth\/group\/\d+\/change\/$/);
  await expect(page.getByLabel('Názov skupiny', { exact: true })).toHaveValue('browser.reviewers');
  await page.getByLabel('Názov skupiny', { exact: true }).fill('browser.reviewers.updated');
  await page.getByRole('button', { name: 'Uložiť skupinu', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'browser.reviewers.updated', exact: true }),
  ).toBeVisible();
  await page.goto(new URL(page.url()).pathname.replace('/change/', '/delete/'));
  await page.getByRole('button', { name: 'Potvrdiť vymazanie', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/auth\/group\/$/);
  await expect(
    page.getByRole('link', { name: 'browser.reviewers.updated', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Zoznam účtov', exact: true }).click();
  await page.getByRole('link', { name: 'live.staff.created', exact: true }).click();
  await page.goto(new URL(page.url()).pathname.replace('/change/', '/delete/'));
  await page.getByRole('button', { name: 'Potvrdiť vymazanie', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/auth\/user\/$/);
  await expect(page.getByRole('link', { name: 'live.staff.created', exact: true })).toHaveCount(0);
});

test('staff change their own password with current-password verification and sign in again', async ({
  page,
}) => {
  await signInStaff(page, 'live.staff.viewer');
  await page.goto('/admin/password_change/');
  await page.getByLabel('Súčasné heslo', { exact: true }).fill('incorrect');
  const replacement = 'browser-staff-own-password-replacement';
  await page.getByLabel('Nové heslo', { exact: true }).fill(replacement);
  await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
  await expect(page.locator('.notice.err')).toContainText('current password');
  await page.getByLabel('Súčasné heslo', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
  await page.getByLabel('Používateľ', { exact: true }).fill('live.staff.viewer');
  await page.getByLabel('Heslo', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zmeniť heslo', exact: true })).toBeVisible();
});

test('a created account follows its activation mail and signs in with the chosen password', async ({
  page,
}) => {
  const database = new pg.Pool();
  try {
    await signInStaff(page, 'live.staff.root');
    await page.getByRole('link', { name: 'Nový účet', exact: true }).click();
    await page.getByLabel('Používateľ', { exact: true }).fill('live.activation');
    await page.getByLabel('E-mail', { exact: true }).fill('activation.browser@example.test');
    await page.getByLabel('Nové heslo', { exact: true }).fill('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
    await page
      .getByLabel('Potvrďte nové heslo', { exact: true })
      .fill('Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3');
    await page.getByRole('button', { name: 'Uložiť účet', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/auth\/user\/\d+\/change\/$/);
    let url = '';
    await expect
      .poll(async () => {
        url =
          (
            await database.query('SELECT url FROM identity_browser_mail WHERE recipient=$1', [
              'activation.browser@example.test',
            ])
          ).rows[0]?.url ?? '';
        return Boolean(url);
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Odhlásiť', exact: true }).click();
    await page.goto(url);
    const password = 'M8!Zh4#Xq7@Nv2$Ks5%Gc9&Pr6';
    await page.getByLabel('Nové heslo', { exact: true }).fill(password);
    await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
    await expect(page).toHaveURL(/\/password_reset\/complete$/);
    await page.getByRole('link', { name: 'Späť na prihlásenie', exact: true }).click();
    await page.getByLabel('Používateľ', { exact: true }).fill('live.activation');
    await page.getByLabel('Heslo', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
  } finally {
    await database.end();
  }
});

test('browser recovery follows the delivered private link and signs in with the replacement password', async ({
  page,
  request,
}) => {
  expect(process.env.PGDATABASE).toBe('atest_back_office_test');
  const database = new pg.Pool();
  const privateRequests: string[] = [];
  page.on('request', (call) => privateRequests.push(call.url()));
  try {
    await page.goto('/password_reset/');
    await page.getByLabel('E-mail', { exact: true }).fill('live.recovery@example.test');
    await page.getByRole('button', { name: 'Odoslať odkaz', exact: true }).click();
    await expect(
      page.getByText('Ak je účet oprávnený na obnovu, dostanete e-mail s odkazom.'),
    ).toBeVisible();
    let delivered = '';
    await expect
      .poll(async () => {
        delivered =
          (
            await database.query<{ url: string }>(
              'SELECT url FROM identity_browser_mail WHERE recipient = $1 LIMIT 1',
              ['live.recovery@example.test'],
            )
          ).rows[0]?.url ?? '';
        return Boolean(delivered);
      })
      .toBe(true);
    const token = new URL(delivered).hash.slice(1);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    await page.goto(delivered);
    await expect(page.getByLabel('Nové heslo', { exact: true })).toBeVisible();
    await page.getByLabel('Nové heslo', { exact: true }).fill('password');
    await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
    await expect(page.locator('.notice.err')).toContainText('Použite aspoň 15 znakov.');
    await page.getByLabel('Nové heslo', { exact: true }).fill('PasswordPassword1!');
    await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill('PasswordPassword1!');
    await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
    await expect(page.locator('.notice.err')).toContainText('menej predvídateľné heslo');
    const replacement = 'browser-recovery-replacement-credential';
    await page.getByLabel('Nové heslo', { exact: true }).fill(replacement);
    await page.getByLabel('Potvrďte nové heslo', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Zmeniť heslo', exact: true }).click();
    await expect(page).toHaveURL(/\/password_reset\/complete$/);
    await expect(page.getByText('Heslo bolo zmenené. Prihláste sa novým heslom.')).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    ).not.toContain(token);
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    ).not.toContain(replacement);
    expect(
      privateRequests.every(
        (url) => !new URL(url).pathname.includes(token) && !new URL(url).search.includes(token),
      ),
    ).toBe(true);
    await page.getByRole('link', { name: 'Späť na prihlásenie', exact: true }).click();
    await page.getByLabel('Používateľ', { exact: true }).fill('live.recovery');
    await page.getByLabel('Heslo', { exact: true }).fill(replacement);
    await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(
      (
        await request.post('/api-backend/api/password_reset/confirm/', {
          data: { token, password: replacement },
        })
      ).status(),
    ).toBe(404);
    await page.goto(delivered);
    await expect(page.getByText('Odkaz na obnovu hesla je neplatný alebo vypršal.')).toBeVisible();
    await expect(page.getByLabel('Nové heslo', { exact: true })).toHaveCount(0);
  } finally {
    await database.end();
  }
});
