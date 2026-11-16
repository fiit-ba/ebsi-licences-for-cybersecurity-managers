import { expect, test } from '@playwright/test';
import { apiFixture, credentialId, proposalId, signIn } from './api-fixture.ts';

test('sign-in retains the existing tab session and dismissible governance notice link', async ({
  page,
}) => {
  const state = await apiFixture(page, { authenticated: false });
  state.notices = {
    items: [
      {
        proposal_id: proposalId,
        onchain_proposal_id: '7',
        approved: true,
        action: 'suspend',
        reference: 'AT-2026-0142',
        proposed_by: 'bob',
        proposed_at: '2026-11-03T10:00:00Z',
      },
    ],
    total: 1,
    waiting: 0,
  };
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('.signin-notices')).toContainText('AT-2026-0142');
  await page.locator('.signin-notice').click();
  await expect(page).toHaveURL(/\/governance\?proposal=7$/);
  await page.getByRole('button', { name: 'Zavrieť', exact: true }).click();
  await expect(page.locator('.signin-notices')).toHaveCount(0);
  expect(state.reads.filter((path) => path === '/registry/notifications')).toHaveLength(1);
  expect(
    await page.evaluate(() => ({
      token: sessionStorage.getItem('plr.token'),
      user: sessionStorage.getItem('plr.user'),
      refresh: sessionStorage.getItem('plr.refresh'),
    })),
  ).toEqual({ token: 'test-access-token', user: 'alice', refresh: null });
  expect(state.calls[0]).toMatchObject({
    path: '/api/api-token-auth',
    body: { username: 'alice', password: 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3' },
    authorization: undefined,
  });
});

test('token expiry and revoked accreditation keep their existing sign-out behavior', async ({
  page,
}) => {
  let revoked = false;
  await apiFixture(page, {
    override: async (path) =>
      path === '/registry/certificates'
        ? {
            status: 403,
            json: revoked
              ? { reason: 'AccreditationRevoked', detail: 'The accreditation was revoked.' }
              : { code: 'token_not_valid', detail: 'Expired' },
          }
        : undefined,
  });
  await page.goto('/lifecycle');
  await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
  revoked = true;
  await page.goto('/issue');
  await signIn(page);
  await page.locator('a[data-tab="lifecycle"]').click();
  await expect(page.getByRole('button', { name: 'Prihlásiť', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('plr.token'))).toBeNull();
});

test('role navigation, direct routes and English switching preserve the previous layout', async ({
  page,
}) => {
  const state = await apiFixture(page, { roles: ['plr_verifier'] });
  await page.goto('/issue?lang=en');
  await expect(page).toHaveURL(/\/verify\?lang=en$/);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('a[data-tab="issue"]')).toHaveCount(0);
  await expect(page.locator('a[data-tab="governance"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('a[data-tab="verify"]')).toBeVisible();
  expect(state.calls).toHaveLength(0);
});

test('sidebar groups account controls and copies the complete contract address', async ({
  page,
}) => {
  const state = await apiFixture(page);
  const contract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  state.profile.governance_contract = contract;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => sessionStorage.setItem('atest.copied', value),
      },
    });
  });

  await page.goto('/issue');
  const account = page.locator('.account-panel');
  await expect(account.getByRole('radiogroup', { name: 'Jazyk' })).toBeVisible();
  await expect(account.getByRole('button', { name: 'Odhlásiť', exact: true })).toBeVisible();

  const blockchain = page.locator('.statusbar');
  const copy = page.getByRole('button', { name: 'Kopírovať adresu kontraktu' });
  const before = await blockchain.boundingBox();
  const copyBefore = await copy.boundingBox();
  await copy.click();
  await expect(page.getByText('Skopírované', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('atest.copied'))).toBe(contract);
  expect(await blockchain.boundingBox()).toEqual(before);
  expect(await copy.boundingBox()).toEqual(copyBefore);
});

test('issuance preserves schema fields, organization defaults, validity and separate QR/PIN handoff', async ({
  page,
}) => {
  const state = await apiFixture(page);
  await page.goto('/issue');
  await page.getByLabel('Interná referencia držiteľa', { exact: true }).fill(' HOLDER-0142 ');
  await page.getByLabel('Číslo osvedčenia', { exact: true }).fill('AT-2026-0142');
  await page.getByLabel('Meno a priezvisko', { exact: true }).fill('Test Holder');
  await expect(page.getByLabel('Vydavateľ osvedčenia', { exact: true })).toHaveValue(
    'Odborná akadémia',
  );
  await page.getByLabel('Platnosť do (voliteľné)').fill('2030-10-03');
  await page.getByRole('button', { name: 'Vydať certifikát', exact: true }).click();
  await expect(page.getByText('928417', { exact: true })).toBeVisible();
  await expect(page.locator('img.offer-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(state.calls.find((call) => call.path === '/registry/issue')).toMatchObject({
    body: {
      credential_type: 'TrainingCertificate',
      holder_reference: 'HOLDER-0142',
      claims: {
        certificateNumber: 'AT-2026-0142',
        holderName: 'Test Holder',
        certificationBody: 'Odborná akadémia',
      },
      valid_until: '2030-10-03T21:59:59.000Z',
    },
    authorization: 'Bearer test-access-token',
  });
  expect(
    await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage })),
  ).not.toContain('928417');
});

test('lifecycle keeps independent approval and highlighted deep links', async ({ page }) => {
  const state = await apiFixture(page, { roles: ['plr_status_manager'] });
  state.proposals = [
    {
      proposal_id: proposalId,
      credential_id: credentialId,
      reference: 'AT-2026-0142',
      action: 'suspend',
      proposed_by: 'alice',
      approved: false,
      can_approve: false,
      reason_code: 'key_compromise',
    },
  ];
  await page.goto('/lifecycle?case=' + proposalId);
  const row = page.locator('#case-' + proposalId);
  await expect(row).toHaveClass(/row-highlight/);
  await expect(row.getByRole('button', { name: 'Schváliť', exact: true })).toBeDisabled();
  state.proposals[0].can_approve = true;
  state.proposals[0].proposed_by = 'bob';
  await page.reload();
  await row.getByRole('button', { name: 'Schváliť', exact: true }).click();
  await expect
    .poll(() => state.calls.filter((call) => call.path === '/registry/approve').length)
    .toBe(1);
  expect(state.calls.find((call) => call.path === '/registry/approve')?.body).toEqual({
    proposal_id: proposalId,
  });
  await expect(page.getByText(/Schválené.*kontrakt/).first()).toBeVisible();
});

test('lifecycle automatically reconciles phone issuance and collection without a reload', async ({
  page,
}) => {
  const state = await apiFixture(page);
  await page.goto('/lifecycle');
  await expect(page.getByText('AT-2026-0142', { exact: true })).toBeVisible();

  await page.getByLabel('Vyhľadať certifikát', { exact: true }).fill('rozpísaný filter');
  const phoneCertificate = {
    credential_id: 'urn:uuid:33333333-3333-4333-8333-333333333333',
    holder_reference: 'PHONE-0171',
    reference: 'AT-2026-0171',
    certification_body: 'Odborná akadémia',
    state: 'active',
    effective_state: 'active',
    collected: false,
    issued_at: '2026-11-05T16:19:00Z',
    valid_until: '2030-11-05T16:19:00Z',
    allowed_actions: [],
    has_open_proposal: false,
    can_emergency_suspend: false,
  };
  state.certificates.unshift(phoneCertificate);

  const phoneRow = page.locator('tbody tr').filter({ hasText: 'AT-2026-0171' });
  await expect(phoneRow).toContainText('nevyzdvihnutý', { timeout: 7000 });
  await expect(page.getByLabel('Vyhľadať certifikát', { exact: true })).toHaveValue(
    'rozpísaný filter',
  );

  phoneCertificate.collected = true;
  await expect(phoneRow).toContainText('platný', { timeout: 7000 });
  expect(state.reads.filter((path) => path === '/registry/certificates').length).toBeGreaterThan(2);
});

test('proposal creation and emergency suspension retain their reason payloads', async ({
  page,
}) => {
  const state = await apiFixture(page);
  await page.goto('/lifecycle');
  await page.getByRole('button', { name: 'Pozastaviť', exact: true }).click();
  await page.getByLabel('Dôvod', { exact: true }).selectOption('other');
  await expect(page.locator('.decision button[type="submit"]')).toBeDisabled();
  await page.getByLabel('Poznámka (povinná)', { exact: true }).fill('Existing reason');
  await page.locator('.decision button[type="submit"]').click();
  await expect
    .poll(() => state.calls.filter((call) => call.path === '/registry/propose').length)
    .toBe(1);
  expect(state.calls.find((call) => call.path === '/registry/propose')?.body).toMatchObject({
    credential_id: credentialId,
    action: 'suspend',
    reason_code: 'other',
    reason_note: 'Existing reason',
  });
  state.proposals = [];
  await page.reload();
  await page.getByRole('button', { name: 'Núdzovo pozastaviť', exact: true }).click();
  await page.locator('.decision button[type="submit"]').click();
  await expect
    .poll(() => state.calls.filter((call) => call.path === '/registry/emergency-suspend').length)
    .toBe(1);
  expect(
    state.calls.find((call) => call.path === '/registry/emergency-suspend')?.body,
  ).toMatchObject({ credential_id: credentialId, reason_code: 'key_compromise', reason_note: '' });
});

test('verification preserves request QR, evidence, disclosure deadline and reset on navigation', async ({
  page,
}) => {
  const state = await apiFixture(page, { roles: ['plr_verifier'] });
  state.presentation = {
    status: 'done',
    verified: true,
    outcome: 'VALID',
    created_at: '2026-11-03T10:00:00Z',
    credential_types: ['TrainingCertificate'],
    checks: {},
    attributes_until: new Date(Date.now() + 6000).toISOString(),
    credentials: [
      {
        state: 'VALID',
        issuer: 'did:ebsi:test',
        credential_type: 'TrainingCertificate',
        attributes: { holderName: 'Private Holder' },
        checks: {},
      },
    ],
  };
  await page.goto('/verify');
  await page.locator('.panel').first().getByRole('button').first().click();
  await expect(page.locator('img.qr-preview')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByText('Private Holder', { exact: true })).toBeVisible();
  await expect(page.getByText(/Zobrazené do/)).toBeVisible();
  await page.locator('a[data-tab="governance"]').click();
  await page.locator('a[data-tab="verify"]').click();
  await expect(page.getByText('Private Holder', { exact: true })).toHaveCount(0);
  expect(state.reads).toContain('/registry/presentation-result');
});

test('holder-initiated exchange preserves the existing request endpoint', async ({ page }) => {
  const state = await apiFixture(page, { roles: ['plr_verifier'] });
  state.presentation = {
    status: 'done',
    verified: false,
    outcome: 'INVALID_SIGNATURE',
    checks: {},
    credentials: [],
    created_at: '2026-11-03T10:00:00Z',
  };
  await page.goto('/verify');
  await page
    .getByLabel('Obsah QR kódu', { exact: true })
    .fill('openid-vc://existing-holder-invitation');
  await page
    .locator('.panel')
    .filter({ has: page.locator('#holder-invitation') })
    .getByRole('button')
    .last()
    .click();
  await expect(page.getByText('INVALID_SIGNATURE', { exact: true })).toBeVisible();
  expect(state.calls.find((call) => call.path === '/registry/presentation-exchange')?.body).toEqual(
    { invitation: 'openid-vc://existing-holder-invitation' },
  );
});

test('organization, schema and audit routes keep their existing API consumers', async ({
  page,
}) => {
  const state = await apiFixture(page, { roles: ['plr_rtao', 'plr_auditor'] });
  await page.goto('/accreditation');
  await expect(page.getByText('RootTAO', { exact: true }).first()).toBeVisible();
  await page.locator('a[data-tab="schemas"]').click();
  await expect(page.getByText('TrainingCertificate', { exact: true }).first()).toBeVisible();
  await page.locator('a[data-tab="audit"]').click();
  await expect(page.getByRole('heading', { name: 'Auditný záznam', exact: true })).toBeVisible();
  expect(state.reads).toEqual(
    expect.arrayContaining(['/registry/trust-chain', '/registry/schemas', '/registry/audit']),
  );
  expect(state.calls).toHaveLength(0);
});

test('untrusted schema labels render as text and retain the previous shell', async ({ page }) => {
  await apiFixture(page, {
    roles: ['plr_auditor'],
    override: async (path) =>
      path === '/registry/schemas'
        ? {
            json: {
              can_manage: false,
              schemas: [
                {
                  credential_type: '<script>alert(1)</script>',
                  name: { sk: '<img src=x onerror=alert(1)>' },
                  versions: [],
                  retired_at: null,
                },
              ],
            },
          }
        : undefined,
  });
  await page.goto('/schemas');
  await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
});
