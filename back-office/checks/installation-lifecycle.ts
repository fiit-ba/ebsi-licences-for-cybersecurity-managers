import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { JsonRpcProvider } from 'ethers';

if (
  process.env.ATEST_INSTALLATION_TEST !== 'isolated' ||
  !process.env.BACK_OFFICE_ACCEPTANCE_RPC_URL
)
  throw new Error('Use a disposable installation and its task-owned ledger only.');
const state = JSON.parse(await readFile(process.env.BACK_OFFICE_ACCEPTANCE_STATE_FILE!, 'utf8'));
const provider = new JsonRpcProvider(process.env.BACK_OFFICE_ACCEPTANCE_RPC_URL);

/**
 * Exercise an existing HTTP operation on the ordinary running installation.
 * @param path - Existing API route.
 * @param token - Current operator bearer, omitted for login.
 * @param body - Optional JSON input, otherwise GET.
 * @param expected - Required HTTP status.
 * @returns Actual parsed JSON result.
 * @throws Assertion, HTTP or JSON errors; caller never dumps bearer material.
 */
async function api(path: string, token = '', body?: unknown, expected = 200) {
  const response = await fetch(state.origin + path, {
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

/**
 * Observe background delivery through the current public API rather than forcing queue work.
 * @param observation - Asynchronous condition over real API/ledger state.
 * @param description - Public failure description.
 * @returns Completion when the expected durable state is observed.
 * @throws Assertion when the bounded observation window expires; observation failures propagate.
 */
async function waitFor(observation: () => Promise<boolean>, description: string) {
  for (let i = 0; i < 100; i++) {
    if (await observation()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.fail(description);
}

try {
  const root = (
    await api('/api/api-token-auth', '', { username: state.username, password: state.password })
  ).access;
  const suffix = randomUUID().slice(0, 8);
  const options = await api('/admin/accounts/options/', root);
  const groupIds: Record<string, number> = Object.fromEntries(
    options.groups.map((group: { name: string; id: number }) => [group.name, group.id]),
  );
  for (const name of [
    'plr_status_manager',
    'plr_auditor',
    'plr_governance_a',
    'plr_governance_b',
  ]) {
    if (!groupIds[name])
      groupIds[name] = (await api('/admin/groups/', root, { name, permission_ids: [] }, 201)).id;
  }
  const actors: Record<string, { account: any; token: string }> = {};
  for (const [name, memberships] of [
    ['proposer', ['plr_status_manager', 'plr_auditor', 'plr_governance_a']],
    ['approver', ['plr_status_manager', 'plr_governance_b']],
  ] as const) {
    const username = name + '.' + suffix;
    const account = await api(
      '/admin/accounts/',
      root,
      {
        username,
        email: username + '@example.test',
        password: state.password,
        active: true,
        first_name: '',
        last_name: '',
        is_staff: false,
        is_superuser: false,
        group_ids: memberships.map((name) => groupIds[name]),
        permission_ids: [],
      },
      201,
    );
    const token = (await api('/api/api-token-auth', '', { username, password: state.password }))
      .access;
    actors[name] = { account, token };
  }
  const credential = decodeJwt(state.credential.split('~')[0]).vc as { id: string };
  const certificates = () => api('/registry/certificates/', actors.proposer.token);
  const current = async () =>
    (await certificates()).results.find(
      (row: { credential_id: string }) => row.credential_id === credential.id,
    );
  assert.equal((await current()).state, 'active');
  await api('/registry/audit/', actors.approver.token, undefined, 403);

  for (const [action, finalState] of [
    ['suspend', 'suspended'],
    ['reinstate', 'active'],
    ['revoke', 'revoked'],
  ] as const) {
    const proposal = await api(
      '/registry/propose/',
      actors.proposer.token,
      {
        credential_id: credential.id,
        action,
        reason_code: action === 'reinstate' ? 'none' : 'other',
        reason_note: action === 'reinstate' ? '' : 'Installation private evidence',
      },
      201,
    );
    const self = await api(
      '/registry/approve/',
      actors.proposer.token,
      { proposal_id: proposal.proposal_id },
      403,
    );
    assert.equal(self.reason, 'FourEyes');
    const approved = await api('/registry/approve/', actors.approver.token, {
      proposal_id: proposal.proposal_id,
    });
    assert.equal(approved.applied, false);
    assert.equal(approved.awaiting, 'governance contract');
    if (action === 'revoke') {
      await waitFor(async () => {
        const row = (
          await api(
            '/registry/proposals/?proposal_id=' + proposal.proposal_id,
            actors.proposer.token,
          )
        ).results[0];
        return row?.onchain_state === 'approved';
      }, 'Ordinary worker did not reach the real revocation timelock.');
      assert.equal((await current()).state, 'active');
      // Advance only the task-owned anvil clock; contract rules remain unchanged.
      await provider.send('evm_increaseTime', [86401]);
      await provider.send('evm_mine', []);
    }
    await waitFor(
      async () => (await current()).state === finalState,
      'Ordinary KMS/ledger worker did not apply ' + action,
    );
  }
  const audit = await api('/registry/audit/', actors.proposer.token);
  assert.ok(!JSON.stringify(audit).includes('Installation private evidence'));
  assert.ok(JSON.stringify(audit).includes('proposal'));

  const before = await api('/admin/accounts/' + actors.approver.account.id + '/', root);
  const {
    id,
    version,
    username,
    email,
    first_name,
    last_name,
    active,
    is_staff,
    is_superuser,
    permission_ids,
  } = before;
  await api('/admin/accounts/', root, {
    account_id: id,
    version,
    username,
    email,
    first_name,
    last_name,
    active,
    is_staff,
    is_superuser,
    group_ids: [],
    permission_ids,
  });
  await api('/registry/me/', actors.approver.token, undefined, 401);
  const stripped = (await api('/api/api-token-auth', '', { username, password: state.password }))
    .access;
  await api('/registry/certificates/', stripped, undefined, 403);
  console.log(
    'Ordinary API/KMS/worker: suspension, reinstatement, timelocked revocation, independent humans, audit privacy and removed live roles passed.',
  );
} catch (error) {
  console.error('Installation lifecycle check failed:', (error as Error).message);
  process.exitCode = 1;
} finally {
  provider.destroy();
}
