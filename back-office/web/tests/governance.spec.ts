import { expect, test } from '@playwright/test';
import type { Contract } from 'ethers';
import { governanceFixture } from './governance-fixture.ts';

// Proposal states as the contract numbers them.
const PROPOSED = 1;
const APPROVED = 2;
const EXECUTED = 3;
const CANCELLED = 4;

test.describe.configure({ mode: 'serial' });

test('back-office signing, execution and confirmed veto retain the existing contract behavior', async ({
  page,
}) => {
  const fixture = await governanceFixture(page);
  await page.goto('/governance?proposal=' + fixture.proposal);
  const row = page.locator('#proposal-' + fixture.proposal);
  await expect(row).toHaveClass(/row-highlight/);
  await row.getByRole('button', { name: 'Podpísať', exact: true }).click();
  await expect
    .poll(async () => Number((await fixture.governance.getProposal(fixture.proposal)).state))
    .toBe(APPROVED);
  await row.getByRole('button', { name: 'Vykonať', exact: true }).click();
  await expect
    .poll(async () => Number((await fixture.governance.getProposal(fixture.proposal)).state))
    .toBe(EXECUTED);
  expect(
    fixture.state.calls
      .filter((call) => call.path === '/registry/governance/vote')
      .map((call) => call.body),
  ).toEqual([
    { proposal_id: String(fixture.proposal), vote: 'sign', role: 'B' },
    { proposal_id: String(fixture.proposal), vote: 'execute', role: 'B' },
  ]);
  const second = await fixture.makeProposal('veto');
  await page.reload();
  await page
    .locator('#proposal-' + second)
    .getByRole('button', { name: 'Vetovať', exact: true })
    .click();
  expect(Number((await fixture.governance.getProposal(second)).state)).toBe(PROPOSED);
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Vetovať návrh', exact: true })
    .click();
  await expect
    .poll(async () => Number((await fixture.governance.getProposal(second)).state))
    .toBe(CANCELLED);
  expect(fixture.rpcCalls).toContain('eth_call');
});

test('external wallet enforces the chain, simulates before signing and requests backend reconciliation', async ({
  page,
}) => {
  const fixture = await governanceFixture(page, { wallet: true, wrongChain: true });
  await page.goto('/governance');
  await page.getByRole('button', { name: 'Pripojiť peňaženku', exact: true }).click();
  const row = page.locator('#proposal-' + fixture.proposal);
  await expect(row.getByRole('button', { name: 'Podpísať', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Prepnúť sieť', exact: true }).click();
  await row.getByRole('button', { name: 'Podpísať', exact: true }).click();
  await expect
    .poll(async () => Number((await fixture.governance.getProposal(fixture.proposal)).state))
    .toBe(APPROVED);
  await expect
    .poll(
      () => fixture.state.calls.filter((call) => call.path === '/registry/governance/sync').length,
    )
    .toBe(1);
  const methods = fixture.walletCalls.map((call) => call.method);
  expect(methods.indexOf('eth_call')).toBeLessThan(methods.indexOf('eth_sendTransaction'));
  expect(fixture.state.calls.some((call) => call.path === '/registry/governance/vote')).toBe(false);
  expect(
    fixture.walletCalls.some((call) => /private|signTypedData|personal_sign/.test(call.method)),
  ).toBe(false);
});

test('back-office rule administration preserves the proposal payload and current policy check', async ({
  page,
}) => {
  const fixture = await governanceFixture(page);
  const before = Number(await fixture.governance.adminProposalCount());
  await page.goto('/governance');
  await page.getByLabel('Zmena', { exact: true }).selectOption('set_proposal_ttl');
  await page.locator('#r-ttl').fill('31');
  await page.getByRole('button', { name: 'Navrhnúť zmenu', exact: true }).click();
  await expect
    .poll(async () => Number(await fixture.governance.adminProposalCount()))
    .toBe(before + 1);
  expect(
    fixture.state.calls.find((call) => call.path === '/registry/governance/admin')?.body,
  ).toEqual({
    vote: 'propose',
    role: 'B',
    change: { action: 'set_proposal_ttl', ttl: 31 * 86400 },
    ti: fixture.ti.did,
  });
  expect(fixture.state.calls.some((call) => call.path === '/registry/governance/admin/check')).toBe(
    true,
  );
});

test('external wallet proposes and co-signs an existing rule change through the contract', async ({
  page,
}) => {
  const fixture = await governanceFixture(page, { wallet: true });
  const before = Number(await fixture.governance.adminProposalCount());
  await page.goto('/governance');
  await page.getByRole('button', { name: 'Pripojiť peňaženku', exact: true }).click();
  await page.getByLabel('Zmena', { exact: true }).selectOption('set_proposal_ttl');
  await page.locator('#r-ttl').fill('31');
  await page.getByRole('button', { name: 'Navrhnúť zmenu', exact: true }).click();
  await expect
    .poll(async () => Number(await fixture.governance.adminProposalCount()))
    .toBe(before + 1);
  const id = before + 1;
  expect((await fixture.governance.getAdminProposal(id)).tiId).toBe(fixture.tiId);
  // The TI's key A completes the supervisory authority's proposal; with no timelock it applies.
  await (
    await (fixture.governance.connect(fixture.keys.a) as Contract).signAdminProposal(id)
  ).wait();
  await expect
    .poll(async () => Number((await fixture.governance.getAdminProposal(id)).state))
    .toBe(EXECUTED);
  expect(Number((await fixture.governance.getTi(fixture.tiId)).proposalTtl)).toBe(31 * 86400);
  expect(fixture.state.calls.some((call) => call.path === '/registry/governance/admin')).toBe(
    false,
  );
});

test('audit verification has the certificate registry compute the record key of the issuer and licence', async ({
  page,
}) => {
  const fixture = await governanceFixture(page);
  const certificateId = 'urn:uuid:' + crypto.randomUUID();
  const proposal = await fixture.makeProposal('audit', certificateId);

  await page.goto('/governance');
  await page.getByLabel('ID návrhu', { exact: true }).fill(String(proposal));
  await page.getByLabel('DID vydavateľa', { exact: true }).fill(fixture.ti.did);
  await page.getByLabel('Identifikátor licencie', { exact: true }).fill(certificateId);
  await page.getByRole('button', { name: 'Overiť kľúč záznamu', exact: true }).click();

  await expect(page.getByText('Zhoda — návrh na chaine patrí k tomuto certifikátu.')).toBeVisible();
});
