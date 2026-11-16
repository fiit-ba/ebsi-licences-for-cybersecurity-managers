import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
const database = new pg.Pool();
test.describe.configure({ mode: 'serial' });
test.afterAll(() => database.end());
let proposal = '';
let onchain = '';
let credential = '';

/**
 * Sign into the actual replacement identity API through the unchanged browser form.
 * @param page - Isolated headless Chromium page.
 * @param suffix - Synthetic lifecycle account suffix.
 * @returns Completion once the form has submitted a real session.
 */
async function login(page: Page, suffix: string) {
  await page.goto('/governance');
  await page.getByLabel('Používateľ', { exact: true }).fill('browser.lifecycle.' + suffix);
  await page.getByLabel('Heslo', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Prihlásiť', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Odhlásiť', exact: true })).toBeVisible();
}

/**
 * Execute a real browser API request using the tab's current authenticated session.
 * @param page - Browser page with a real API session.
 * @param path - Existing API path.
 * @param body - Optional existing JSON request body.
 * @returns Actual HTTP status and JSON body.
 */
async function api(page: Page, path: string, body?: object) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch('/api-backend' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: 'Bearer ' + sessionStorage.getItem('plr.token'),
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body },
  );
}

test('existing lifecycle form opens an auditable case and A proposal before approval', async ({
  page,
}) => {
  await login(page, 'proposer');
  await page.goto('/lifecycle');
  await expect(page.getByRole('cell', { name: 'STAGE5', exact: true })).toBeVisible();
  const certificates = await api(page, '/registry/certificates/');
  credential = certificates.body.results[0].credential_id;
  await page.getByRole('button', { name: 'Odňať', exact: true }).click();
  await page.getByLabel('Dôvod', { exact: true }).selectOption('other');
  await page.getByLabel('Poznámka (povinná)', { exact: true }).fill('private browser evidence');
  await page.getByRole('button', { name: 'Navrhnúť', exact: true }).click();
  await expect.poll(async () => (await api(page, '/registry/proposals/')).body.total).toBe(1);
  proposal = (await api(page, '/registry/proposals/')).body.results[0].proposal_id;
  await expect
    .poll(
      async () =>
        (
          await database.query(
            'SELECT onchain_proposal_id FROM certificate_status_proposals WHERE id=$1',
            [proposal],
          )
        ).rows[0].onchain_proposal_id,
    )
    .not.toBeNull();
  onchain = (
    await database.query(
      'SELECT onchain_proposal_id FROM certificate_status_proposals WHERE id=$1',
      [proposal],
    )
  ).rows[0].onchain_proposal_id;
  const self = await api(page, '/registry/governance/vote/', {
    proposal_id: onchain,
    vote: 'sign',
    role: 'B',
  });
  expect(self.status).toBe(403);
  expect(self.body.reason).toBe('FourEyes');
});

test('signer-only B uses the existing governance screen and waits for actual revocation timelock', async ({
  page,
}) => {
  await login(page, 'second');
  await page.goto('/governance?proposal=' + onchain);
  const row = page.locator('#proposal-' + onchain);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Podpísať', exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await database.query('SELECT decision FROM certificate_status_proposals WHERE id=$1', [
            proposal,
          ])
        ).rows[0].decision,
    )
    .toBe('approved');
  await expect
    .poll(
      async () =>
        (
          await database.query(
            'SELECT onchain_state FROM certificate_status_proposals WHERE id=$1',
            [proposal],
          )
        ).rows[0].onchain_state,
    )
    // Approved by A and B; executable once the revocation timelock has passed.
    .toBe('approved');
  expect((await api(page, '/registry/certificates/')).status).toBe(403);
  expect((await api(page, '/registry/audit/')).status).toBe(403);
  expect(
    (
      await api(page, '/registry/governance/vote/', {
        proposal_id: onchain,
        vote: 'execute',
        role: 'B',
      })
    ).body.reason,
  ).toBe('TimelockNotElapsed');
});

test('existing rule form enforces separate humans against the actual administration contract', async ({
  page,
  browser,
}) => {
  await login(page, 'mixed');
  await page.goto('/governance');
  // The journal keeps earlier runs' entries: look only at what this proposal adds.
  const before = (await database.query('SELECT coalesce(max(id),0) AS id FROM audit_entries'))
    .rows[0].id;
  const proposed = async () =>
    (
      await database.query(
        "SELECT detail->>'admin_proposal_id' AS id FROM audit_entries WHERE event='governance.admin_proposed' AND actor_username='browser.lifecycle.mixed' AND id>$1 ORDER BY id DESC LIMIT 1",
        [before],
      )
    ).rows[0]?.id;
  await page.getByLabel('Zmena', { exact: true }).selectOption('set_proposal_ttl');
  await page.locator('#r-ttl').fill('31');
  await page.getByRole('button', { name: 'Navrhnúť zmenu', exact: true }).click();
  await expect.poll(proposed).toBeTruthy();
  const id = await proposed();
  expect(
    (
      await api(page, '/registry/governance/admin/', {
        vote: 'sign',
        role: 'B',
        admin_proposal_id: id,
      })
    ).body.reason,
  ).toBe('FourEyes');
  const second = await browser.newContext();
  const other = await second.newPage();
  await login(other, 'second');
  expect(
    (
      await api(other, '/registry/governance/admin/', {
        vote: 'sign',
        role: 'B',
        admin_proposal_id: id,
      })
    ).status,
  ).toBe(200);
  await second.close();
});

test('audit screen and source preimages retain reason privacy and recorded disclosure', async ({
  page,
}) => {
  await login(page, 'auditor');
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit certifikátu', exact: true })).toBeVisible();
  const history = await api(
    page,
    '/registry/audit/?credential_id=' + encodeURIComponent(credential),
  );
  expect(history.status).toBe(200);
  expect(history.body.chain_intact).toBe(true);
  expect(JSON.stringify(history.body.results)).not.toContain('private browser evidence');
  const reason = await api(page, '/registry/audit/reason-preimage/', {
    onchain_proposal_id: onchain,
  });
  expect(reason.status).toBe(200);
  expect(reason.body.reason_note).toBe('private browser evidence');
  expect(reason.body.reason_hash).toMatch(/^[0-9a-f]{64}$/);
  await page.getByPlaceholder('napr. 12').fill(onchain);
  await page.getByRole('button', { name: 'Overiť dôvod', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Sprístupniť', exact: true })
    .click();
  await expect(page.getByText('0x' + reason.body.reason_hash, { exact: true })).toBeVisible();
  await expect(
    page.getByText('Zhoda — návrh na chaine bol otvorený práve s týmto dôvodom.', { exact: true }),
  ).toBeVisible();
  const preimage = await api(page, '/registry/audit/commitment-preimage/', {
    credential_id: credential,
  });
  expect(preimage.status).toBe(200);
  // What the record key is computed from: the TI and the collected credential's id.
  expect(preimage.body.certificate_id).toBe(credential);
  expect(preimage.body.status_key).toMatch(/^0x[0-9a-f]{64}$/);
  const events = await api(
    page,
    '/registry/audit/?credential_id=' + encodeURIComponent(credential),
  );
  expect(
    events.body.results.some((row: { event: string }) => row.event === 'audit.reason_disclosed'),
  ).toBe(true);
  expect(
    events.body.results.some((row: { event: string }) => row.event === 'audit.preimage_disclosed'),
  ).toBe(true);
});

test('external supervisory wallet veto reaches the real contract and actual backend reconciliation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const bridge = window as unknown as { ethereum: unknown; walletMethods: string[] };
    bridge.walletMethods = [];
    let connected = false;
    const rpc = async (method: string, params: unknown[] = []) => {
      const response = await fetch('/api-ledger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    };
    bridge.ethereum = {
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        bridge.walletMethods.push(method);
        if (method === 'eth_requestAccounts') connected = true;
        // The supervisory authority's development key (contracts Networks.sol key 5), a key of
        // the DID every test TI names as its role C cosigner.
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
          return connected ? [(await rpc('eth_accounts'))[5]] : [];
        return rpc(method, params);
      },
      on: () => {},
      removeListener: () => {},
    };
  });
  await login(page, 'auditor');
  await page.goto('/governance?proposal=' + onchain);
  await page.getByRole('button', { name: 'Externá peňaženka signatára', exact: true }).click();
  await page.getByRole('button', { name: 'Pripojiť peňaženku', exact: true }).click();
  const row = page.locator('#proposal-' + onchain);
  await row.getByRole('button', { name: 'Vetovať', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Vetovať návrh', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await database.query(
            'SELECT onchain_state FROM certificate_status_proposals WHERE id=$1',
            [proposal],
          )
        ).rows[0].onchain_state,
    )
    .toBe('cancelled');
  const record = (
    await database.query(
      'SELECT applied_at,closed_at FROM certificate_status_proposals WHERE id=$1',
      [proposal],
    )
  ).rows[0];
  expect(record.applied_at).toBeNull();
  expect(record.closed_at).not.toBeNull();
  const methods = await page.evaluate(
    () => (window as unknown as { walletMethods: string[] }).walletMethods,
  );
  expect(methods).toContain('eth_sendTransaction');
  expect(methods.some((method) => /personal_sign|eth_signTypedData/.test(method))).toBe(false);
});

test('audit screen renders detected tampering from damaged PostgreSQL copies without a rendering failure', async ({
  page,
}) => {
  await database.query(`BEGIN;
    DROP VIEW stage5_browser_audit.audit_entries;
    DROP VIEW stage5_browser_audit.audit_head;
    CREATE TABLE stage5_browser_audit.audit_entries AS SELECT * FROM public.audit_entries;
    CREATE TABLE stage5_browser_audit.audit_head AS SELECT * FROM public.audit_head;
    UPDATE stage5_browser_audit.audit_entries SET detail='{}' WHERE id=(SELECT min(id) FROM stage5_browser_audit.audit_entries);
    COMMIT`);
  await login(page, 'auditor');
  await page.goto('/audit');
  await expect(page.getByText('Zásah do audit logu:', { exact: false })).toBeVisible();
  const response = await api(page, '/registry/audit/');
  expect(response.status).toBe(200);
  expect(response.body.chain_intact).toBe(false);
  expect(response.body.chain.tampered).toBe(true);
  expect(response.body.chain.altered.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Audit certifikátu', exact: true })).toBeVisible();
});
