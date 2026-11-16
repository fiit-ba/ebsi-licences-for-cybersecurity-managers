import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const state = JSON.parse(await readFile(process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE!, 'utf8'));

test('ordinary built console uses real authentication/API prefixes, direct routes and live role refusals', async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/accreditation');
  await page.getByLabel('Používateľ', { exact: true }).fill(state.username);
  await page.getByLabel('Heslo', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.notice.err')).toBeVisible();
  await page.getByLabel('Heslo', { exact: true }).fill(state.password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  for (const path of ['/schemas', '/accreditation', '/accounts']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('.sidebar')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Odhlásiť', exact: true }).click();
  await page.getByLabel('Používateľ', { exact: true }).fill(state.tiName);
  await page.getByLabel('Heslo', { exact: true }).fill(state.password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  for (const path of ['/issue', '/verify', '/lifecycle']) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.locator('.sidebar')).toBeVisible();
  }
  const token = await page.evaluate(() => sessionStorage.getItem('plr.token'));
  const headers = { authorization: 'Bearer ' + token };
  expect(
    (await request.post('/api-backend/registry/schemas/', { headers, data: {} })).status(),
  ).toBe(403);
  expect(
    (await request.get('/api-backend/registry/certificate-scheme/', { headers })).status(),
  ).toBe(200);
  const direct = await request.get(state.origin + '/registry/certificate-scheme/', { headers });
  expect(direct.status()).toBe(200);
  expect((await direct.json()).schemas[0].credential_type).toBe(state.type);
  const rpc = await request.post('/api-ledger', {
    data: { id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] },
  });
  expect((await rpc.json()).result).toBe('0x7a69');
  expect(failures).toEqual([]);
});
