import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { postgresNotifications } from './notifications.ts';
import { postgresStatusProposals } from './proposals.ts';
import { reasonCommitment } from '../issuance/protection.ts';

test('sign-in notices preserve organization scope, full counts and registry-wide second approval', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const prefix = 'notifications-' + randomUUID();
  const accounts: number[] = [];
  const organizations: string[] = [];
  const certificates: string[] = [];
  const proposals: string[] = [];
  const schema = randomUUID();
  context.after(async () => {
    try {
      await database.query('DELETE FROM certificate_status_proposals WHERE id = ANY($1::uuid[])', [
        proposals,
      ]);
      await database.query('DELETE FROM registered_certificates WHERE id = ANY($1::uuid[])', [
        certificates,
      ]);
      await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id = $1', [
        schema,
      ]);
      await database.query('DELETE FROM certificate_schemas WHERE id = $1', [schema]);
      await database.query('DELETE FROM operator_accounts WHERE id = ANY($1::int[])', [accounts]);
    } finally {
      await database.end();
    }
  });
  for (const [name, role] of [
    ['root', 'plr_rtao'],
    ['tao', 'plr_tao'],
    ['other-tao', 'plr_tao'],
    ['ti', 'plr_status_manager'],
    ['other-ti', 'plr_status_manager'],
    ['second', 'plr_status_manager'],
    ['verifier', 'plr_verifier'],
    ['nobody', ''],
    ['administrator', 'plr_admin'],
  ]) {
    const {
      rows: [row],
    } = await database.query<{ id: number }>(
      'INSERT INTO operator_accounts (username, password_hash) VALUES ($1, $2) RETURNING id',
      [prefix + name, 'unused-for-token-fixture'],
    );
    accounts.push(row.id);
    if (role) await database.query('INSERT INTO operator_roles VALUES ($1,$2)', [row.id, role]);
  }
  const [
    rootActor,
    taoActor,
    otherTaoActor,
    proposer,
    otherProposer,
    second,
    verifier,
    nobody,
    administrator,
  ] = accounts;
  for (const [kind, parent, actor] of [
    ['rtao', null, rootActor],
    ['tao', 0, taoActor],
    ['tao', 0, otherTaoActor],
    ['ti', 1, proposer],
    ['ti', 2, otherProposer],
  ] as const) {
    const id = randomUUID();
    await database.query(
      `INSERT INTO accredited_organizations (id, name, kind, parent_id, account_id, did)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        prefix + kind + actor,
        kind,
        parent === null ? null : organizations[parent],
        actor,
        'did:ebsi:z' + actor,
      ],
    );
    organizations.push(id);
  }
  await database.query(
    'INSERT INTO certificate_schemas (id, credential_type, name_sk) VALUES ($1,$2,$3)',
    [schema, 'Notice' + randomUUID().replaceAll('-', ''), 'Notice'],
  );
  await database.query(
    `INSERT INTO certificate_schema_versions (schema_id, version, fields, tsr_id, registered_at)
    VALUES ($1,1,'[]','fixture',now())`,
    [schema],
  );
  for (let index = 0; index < 13; index++) {
    const certificate = randomUUID();
    const proposal = randomUUID();
    const own = index < 12;
    certificates.push(certificate);
    proposals.push(proposal);
    const actor = own ? proposer : otherProposer;
    await database.query(
      `INSERT INTO registered_certificates
      (id, credential_id, issuer_id, issuer_did, schema_id, schema_version, certificate_number, status_key, credential_hash, private_data, created_by, ledger_standing, ledger_observed_at)
      VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,'active',now())`,
      [
        certificate,
        'urn:uuid:' + certificate,
        organizations[own ? 3 : 4],
        'did:ebsi:z' + actor,
        schema,
        'NOTICE-' + index,
        randomBytes(32),
        randomBytes(32),
        Buffer.from('no-holder-data-needed'),
        actor,
      ],
    );
    const reasonSalt = randomBytes(32);
    await database.query(
      `INSERT INTO certificate_status_proposals
      (id, certificate_id, action, initial_standing, reason_code, reason_note, reason_salt, reason_hash, proposed_by, proposed_at)
      VALUES ($1,$2,'suspend','active','other','Private reason omitted from notices',$3,$4,$5,$6)`,
      [
        proposal,
        certificate,
        reasonSalt,
        reasonCommitment('other', 'Private reason omitted from notices', reasonSalt),
        actor,
        new Date(Date.now() - (13 - index) * 1000),
      ],
    );
  }
  const notifications = postgresNotifications(database);
  const tokens = operatorTokens('notification-test-only-signing-secret');
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    notifications,
    statusProposals: postgresStatusProposals(database),
    reportError: (error) => {
      throw error;
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = new Map<number, { authorization: string }>();
  for (const id of accounts) {
    const pair = await tokens.pair({ id });
    headers.set(id, { authorization: 'Bearer ' + pair.access });
  }
  const read = (actor?: number) =>
    fetch(origin + '/registry/notifications/', { headers: headers.get(actor) });
  assert.equal((await read()).status, 401);
  for (const actor of [nobody, administrator]) {
    assert.equal((await read(actor)).status, 403);
    await assert.rejects(notifications(actor), {
      body: {
        reason: 'RoleRequired',
        detail:
          'This needs one of these roles: plr_issuer, plr_status_manager, plr_verifier, plr_auditor, plr_rtao, plr_tao.',
      },
    });
  }
  const own = await (await read(proposer)).json();
  assert.deepEqual([own.items.length, own.total, own.waiting], [10, 12, 0]);
  assert.equal(own.items[0].reference, 'NOTICE-11');
  assert.ok(own.items.every((item) => !item.can_approve));
  assert.equal(own.items[0].reason_note, undefined);
  assert.equal(own.items[0].reason_hash, undefined);
  assert.equal(own.items[0].holder_reference, undefined);
  assert.equal(own.items[0].issuer, prefix + 'ti' + proposer);
  assert.equal((await (await read(taoActor)).json()).total, 12);
  assert.equal((await (await read(otherTaoActor)).json()).total, 1);
  assert.equal((await (await read(otherProposer)).json()).total, 1);
  assert.equal((await (await read(rootActor)).json()).total, 13);
  const all = await (await read(second)).json();
  assert.deepEqual([all.items.length, all.total, all.waiting], [10, 13, 13]);
  assert.equal(all.items[0].reference, 'NOTICE-12');
  assert.ok(all.items.every((item) => item.can_approve));
  assert.equal((await (await read(verifier)).json()).waiting, 0);
  assert.equal((await (await read(verifier)).json()).total, 13);
  assert.equal((await read(second)).headers.get('cache-control'), 'no-store');

  const selected = proposals[0];
  const listing = await fetch(origin + '/registry/proposals/?proposal_id=' + selected, {
    headers: headers.get(second),
  });
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).results[0].proposal_id, selected);
  assert.equal(
    (
      await fetch(origin + '/registry/proposals/?proposal_id=invalid', {
        headers: headers.get(second),
      })
    ).status,
    400,
  );
  const approve = await fetch(origin + '/registry/approve/', {
    method: 'POST',
    headers: { ...headers.get(second), 'content-type': 'application/json' },
    body: JSON.stringify({ proposal_id: selected }),
  });
  assert.equal(approve.status, 200);
  const after = await notifications(second);
  assert.deepEqual([after.total, after.waiting], [13, 12]);
  await database.query(
    `UPDATE certificate_status_proposals SET onchain_proposal_id=42, onchain_contract=$2,
    onchain_chain_id=1337, onchain_state='proposed' WHERE id=$1`,
    [selected, '0x' + 'ab'.repeat(20)],
  );
  await database.query(
    'UPDATE certificate_status_proposals SET closed_at=now() WHERE id=ANY($1::uuid[])',
    [proposals.slice(1, 5)],
  );
  const open = await notifications(second);
  assert.deepEqual([open.items.length, open.total, open.waiting], [9, 9, 8]);
  const approved = open.items.find((item) => item.proposal_id === selected)!;
  assert.deepEqual(
    [approved.approved, approved.can_approve, approved.onchain_proposal_id, approved.onchain_state],
    [true, false, '42', 'proposed'],
  );
  await database.query(
    `UPDATE certificate_status_proposals SET decision='rejected',decided_by=$2,decided_at=now() WHERE id=$1`,
    [proposals[5], second],
  );
  await database.query(`UPDATE certificate_status_proposals SET applied_at=now() WHERE id=$1`, [
    selected,
  ]);
  assert.equal((await notifications(second)).total, 7);

  await database.query(
    "DELETE FROM operator_roles WHERE account_id=$1 AND role='plr_status_manager'",
    [second],
  );
  assert.equal((await read(second)).status, 403);
  await database.query(
    "UPDATE accredited_organizations SET revoked_at=now(),revocation_reason='breach' WHERE id=$1",
    [organizations[1]],
  );
  assert.equal((await read(proposer)).status, 401);
  await assert.rejects(notifications(proposer), { status: 401 });
  await database.query('UPDATE operator_accounts SET active=false WHERE id=$1', [verifier]);
  assert.equal((await read(verifier)).status, 401);
  await assert.rejects(notifications(verifier), { status: 401 });
});
