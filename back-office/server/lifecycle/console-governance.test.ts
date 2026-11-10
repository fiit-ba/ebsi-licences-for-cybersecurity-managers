import { transaction } from '../adapters/transaction.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ZeroHash, Wallet, Transaction, type EventLog } from 'ethers';
import { lifecycleFixture } from './fixtures/runtime.ts';
import { postgresStatusProposals } from './proposals.ts';
import { postgresEmergencySuspension } from './emergency.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresLedgerSigning, purgeUnusedSigningIntents } from '../keys/ledger-signing.ts';
import { inspectAudit } from '../audit/journal.ts';
import { postgresCertificateList } from './certificates.ts';
import { postgresAudit } from '../audit/service.ts';

// These are real domain/API/DB/contract checks. KMS is substituted with local EC keys.
test('governance HTTP, actual contract and durable signature evidence', async (context) => {
  const f = await lifecycleFixture();
  context.after(() => f.close());
  const { database, accounts, certificate, credential, registered, governance, contract } = f;
  // Every decision on the contract is the TI's: its id names it.
  const tiId = await contract.computeTiId(f.did);
  const proposals = postgresStatusProposals(database);
  const tokens = operatorTokens('stage5-test-only-session-secret-value');
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    governance,
    statusProposals: proposals,
    emergencySuspend: postgresEmergencySuspension(database),
    listCertificates: postgresCertificateList(database, f.protection),
    audit: postgresAudit(database, f.protection),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const bearer = Object.fromEntries(
    await Promise.all(
      Object.entries(accounts).map(async ([name, id]) => [
        name,
        (await tokens.pair({ id })).access,
      ]),
    ),
  );
  const call = async (path: string, actor = 'proposer', body?: object) => {
    const response = await fetch(origin + '/registry/' + path + '/', {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + bearer[actor], 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  let localId = '';
  let onchain = '';
  await context.test(
    'registry remains available during ledger outage; proposal reaches A before independent approval',
    async () => {
      const row = (await call('certificates')).body.results[0];
      assert.equal(row.state, 'active');
      assert.equal(row.registered_id, registered);
      const proposal = await call('propose', 'proposer', {
        credential_id: registered,
        action: 'revoke',
        reason_code: 'other',
        reason_note: 'private evidence',
      });
      assert.equal(proposal.status, 201);
      localId = proposal.body.proposal_id;
      await f.deliver();
      const record = (
        await database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [localId])
      ).rows[0];
      onchain = record.onchain_proposal_id;
      assert.ok(onchain);
      assert.equal(record.decision, null);
      assert.equal(record.applied_at, null);
      assert.equal((await contract.getProposal(onchain)).signatures.length, 1);
      assert.equal(
        (
          await call('governance/vote', 'proposer', {
            proposal_id: onchain,
            vote: 'execute',
            role: 'A',
          })
        ).body.reason,
        'NotApproved',
      );
      assert.equal(
        (
          await call('governance/vote', 'proposer', {
            proposal_id: onchain,
            vote: 'sign',
            role: 'B',
          })
        ).body.reason,
        'FourEyes',
      );
    },
  );
  await context.test(
    'signer-only B approval survives pending emergency; chain quorum and timelock stay independent',
    async () => {
      const emergency = await call('emergency-suspend', 'proposer', {
        credential_id: credential,
        reason_code: 'key_compromise',
      });
      assert.equal(emergency.status, 200);
      assert.equal((await call('certificates')).body.results[0].state, 'suspended');
      assert.equal(
        (
          await call('governance/vote', 'outsider', {
            proposal_id: onchain,
            vote: 'sign',
            role: 'B',
          })
        ).body.reason,
        'RoleNotAssigned',
      );
      const approved = await call('governance/vote', 'second', {
        proposal_id: onchain,
        vote: 'sign',
        role: 'B',
      });
      assert.equal(approved.status, 202);
      assert.equal(approved.body.approved, true);
      assert.equal((await call('certificates', 'second')).status, 403);
      await f.deliverEmergencies();
      await f.retry();
      await f.deliver();
      const pending = (
        await database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [localId])
      ).rows[0];
      assert.equal(pending.applied_at, null);
      assert.equal((await contract.getProposal(onchain)).signatures.length, 2);
      const early = await call('governance/vote', 'second', {
        proposal_id: onchain,
        vote: 'execute',
        role: 'B',
      });
      assert.equal(early.status, 409);
      assert.equal(early.body.reason, 'TimelockNotElapsed');
      await f.network.increaseTime(86401);
      await f.retry();
      await f.deliver();
      assert.ok(
        (
          await database.query('SELECT applied_at FROM certificate_status_proposals WHERE id=$1', [
            localId,
          ])
        ).rows[0].applied_at,
      );
      assert.equal((await call('certificates')).body.results[0].state, 'revoked');
    },
  );
  await context.test(
    'admin policy, same-person mixed-role refusal and external supervisory wallet',
    async () => {
      const roles = await call('governance/roles', 'second');
      assert.deepEqual(roles.body.roles, ['B']);
      assert.equal(roles.body.addresses.C, undefined);
      const check = await call('governance/admin/check', 'outsider', {
        change: { action: 'add_signer', subject: Wallet.createRandom().address, signer_role: 'A' },
        role: 'A',
        ti: f.did,
      });
      assert.equal(check.body.allowed, false);
      assert.equal(check.body.reason, 'SupervisorFirst');
      const proposed = await call('governance/admin', 'mixed', {
        vote: 'propose',
        role: 'A',
        change: { action: 'set_proposal_ttl', ttl: 31 * 86400 },
        ti: f.did,
      });
      assert.equal(proposed.status, 200, JSON.stringify(proposed));
      const id = proposed.body.admin_proposal_id;
      assert.equal(
        (
          await call('governance/admin', 'mixed', {
            vote: 'sign',
            role: 'B',
            admin_proposal_id: id,
          })
        ).body.reason,
        'FourEyes',
      );
      assert.equal(
        (
          await call('governance/admin', 'second', {
            vote: 'sign',
            role: 'B',
            admin_proposal_id: id,
          })
        ).status,
        200,
      );
      assert.equal(Number((await contract.getTi(tiId)).proposalTtl), 31 * 86400);
      // A signer is a key of the TI's DID; the supervisory authority's key proposes it.
      const newAddress = (await f.network.newTiKey(f.ti)).address;
      await (await contract.connect(f.supervisor).proposeAddSigner(tiId, newAddress, 1)).wait();
      const externalId = String(await contract.adminProposalCount());
      const permitted = await call('governance/admin/check', 'second', {
        admin_proposal_id: externalId,
        role: 'B',
      });
      assert.equal(permitted.body.allowed, true);
      assert.equal(permitted.body.supervisor_first, true);
      assert.equal(
        (
          await call('governance/admin', 'second', {
            vote: 'sign',
            role: 'B',
            admin_proposal_id: externalId,
          })
        ).status,
        200,
      );
      assert.equal(await contract.isSigner(tiId, newAddress), true);
      // A proposal outside the back-office, for another certificate of the TI.
      const target = await contract
        .connect(f.keys[0])
        .proposeAction(
          tiId,
          await f.network.recordCertificate(f.ti),
          0,
          ZeroHash.replace(/0$/, '2'),
        );
      await target.wait();
      const externalStatus = String(await contract.proposalCount());
      await (await contract.connect(f.supervisor).cancelProposal(externalStatus, ZeroHash)).wait();
      assert.equal(
        (await call('governance/sync', 'outsider', { proposal_id: externalStatus })).body.case_id,
        null,
      );
    },
  );
  await context.test(
    'a lost outcome audit cannot erase authorship or authorize the same human to co-sign',
    async () => {
      const actor = accounts.proposer;
      await database.query(`CREATE FUNCTION stage5_refuse_outcome() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event='governance.admin_proposed' AND NEW.actor_id=${actor} THEN RAISE EXCEPTION 'Injected post-send outcome failure'; END IF;
      RETURN NEW; END $$`);
      await database.query(
        'CREATE TRIGGER stage5_refuse_outcome BEFORE INSERT ON audit_entries FOR EACH ROW EXECUTE FUNCTION stage5_refuse_outcome()',
      );
      try {
        const failed = await call('governance/admin', 'proposer', {
          vote: 'propose',
          role: 'A',
          change: { action: 'set_proposal_ttl', ttl: 32 * 86400 },
          ti: f.did,
        });
        assert.equal(failed.status, 502);
      } finally {
        await database.query('DROP TRIGGER stage5_refuse_outcome ON audit_entries');
        await database.query('DROP FUNCTION stage5_refuse_outcome()');
      }
      const intent = (
        await database.query(
          "SELECT * FROM ledger_signing_intents WHERE actor_id=$1 AND contract_function='proposeProposalTtl' ORDER BY consumed_at DESC LIMIT 1",
          [actor],
        )
      ).rows[0];
      assert.ok(intent.admin_proposal_id);
      assert.ok(intent.raw_transaction);
      assert.equal(
        (
          await database.query(
            "SELECT 1 FROM audit_entries WHERE event='governance.admin_proposed' AND detail->>'transaction_hash'=$1",
            [intent.transaction_hash],
          )
        ).rowCount,
        0,
      );
      const attempt = await call('governance/admin', 'proposer', {
        vote: 'sign',
        role: 'B',
        admin_proposal_id: intent.admin_proposal_id,
      });
      assert.equal(attempt.body.reason, 'FourEyes');
      await governance.reconcileSignatures();
      const recovered = await database.query(
        "SELECT 1 FROM audit_entries WHERE event='governance.admin_proposed' AND actor_id=$1 AND detail->>'transaction_hash'=$2",
        [actor, intent.transaction_hash],
      );
      assert.equal(recovered.rowCount, 1);
      await governance.reconcileSignatures();
      assert.equal(
        (
          await database.query(
            "SELECT 1 FROM audit_entries WHERE event='governance.admin_proposed' AND detail->>'transaction_hash'=$1",
            [intent.transaction_hash],
          )
        ).rowCount,
        1,
      );
    },
  );

  await context.test(
    'live removal, deactivation and audit access do not inherit signer memberships',
    async () => {
      await database.query(
        "DELETE FROM operator_governance_roles WHERE account_id=$1 AND role='B'",
        [accounts.second],
      );
      assert.equal(
        (
          await call('governance/admin', 'second', {
            vote: 'propose',
            role: 'B',
            change: { action: 'set_proposal_ttl', ttl: 32 * 86400 },
            ti: f.did,
          })
        ).body.reason,
        'RoleNotAssigned',
      );
      await database.query('UPDATE operator_accounts SET active=false WHERE id=$1', [
        accounts.mixed,
      ]);
      assert.equal((await call('governance/roles', 'mixed')).status, 401);
      assert.equal((await call('audit', 'second')).status, 403);
      const history = await fetch(
        origin + '/registry/audit/?credential_id=' + encodeURIComponent(registered),
        { headers: { authorization: 'Bearer ' + bearer.auditor } },
      );
      assert.equal(history.status, 200);
      assert.ok((await history.json()).results.some((row) => row.proposal_id === localId));
      const chain = await transaction(database, (client) => inspectAudit(client));
      assert.equal(chain.intact, true);
      const events = (
        await database.query(
          "SELECT event,detail FROM audit_entries WHERE event IN ('ledger.tx_signed','key.signed')",
        )
      ).rows;
      assert.ok(events.filter((row) => row.event === 'ledger.tx_signed').length >= 6);
      assert.equal(JSON.stringify(events).includes('private evidence'), false);
      assert.equal(JSON.stringify(events).includes('private-stage5-holder'), false);
    },
  );
  await context.test(
    'exact signing authorization rejects changed transactions, expiry, replay and concurrency',
    async () => {
      const key = Wallet.createRandom().connect(f.keys[0].provider);
      const intents = postgresLedgerSigning(database, {
        signer: key,
        keyId: key.address,
        purpose: 'governance_role_a',
        chainId: Number((await key.provider!.getNetwork()).chainId),
        deployment: { governance: await contract.getAddress(), registry: f.network.registry },
      });
      const id = await intents.create('test-' + certificate, 'signProposal', ['1']);
      const stored = (
        await database.query('SELECT * FROM ledger_signing_intents WHERE id=$1', [id])
      ).rows[0];
      const request = {
        type: 2,
        chainId: BigInt(stored.chain_id),
        to: stored.contract,
        data: stored.calldata,
        value: 0n,
        nonce: 0,
        gasLimit: 100000n,
        maxFeePerGas: 10000000000n,
        maxPriorityFeePerGas: 1000000000n,
      };
      for (const mutation of [
        { to: Wallet.createRandom().address },
        { chainId: request.chainId + 1n },
        { value: 1n },
        { data: '0x' },
        { type: 1 },
      ])
        await assert.rejects(intents.sign(id, { ...request, ...mutation }));
      const race = await Promise.allSettled([intents.sign(id, request), intents.sign(id, request)]);
      assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
      const raw = (
        race.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<string>
      ).value;
      assert.equal(Transaction.from(raw).from, key.address);
      await assert.rejects(intents.sign(id, request));
      const expired = await intents.create('expired-' + certificate, 'execute', ['1']);
      await database.query(
        "UPDATE ledger_signing_intents SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [expired],
      );
      await assert.rejects(intents.sign(expired, request));
      assert.ok(await purgeUnusedSigningIntents(database));
      assert.equal(
        (await database.query('SELECT 1 FROM ledger_signing_intents WHERE id=$1', [id])).rowCount,
        1,
      );
    },
  );
});

test('rejection preserves an earlier independent approval and retries the exact veto after worker restart', async (context) => {
  const f = await lifecycleFixture();
  context.after(() => f.close());
  const proposals = postgresStatusProposals(f.database);
  const opened = await proposals.propose(f.accounts.proposer, {
    credential_id: f.registered,
    action: 'revoke',
    reason_code: 'issued_in_error',
  });
  await f.deliver();
  await proposals.decide(f.accounts.mixed, opened.proposal_id, 'approved');
  await proposals.decide(f.accounts.proposer, opened.proposal_id, 'rejected');
  let row = (
    await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
      opened.proposal_id,
    ])
  ).rows[0];
  assert.equal(row.decided_by, f.accounts.mixed);
  assert.equal(row.decision, 'approved');
  assert.equal(row.rejected_by, f.accounts.proposer);
  assert.equal(row.rejection_delivered_at, null);
  assert.ok(row.closed_at);
  await f.retry();
  // Reconstruct the worker from committed state, as after a process restart.
  const { postgresGovernanceDelivery } = await import('./delivery.ts');
  const { governanceActions } = await import('./governance.ts');
  const worker = postgresGovernanceDelivery(
    f.database,
    governanceActions({
      chainId: f.network.chainId,
      address: await f.contract.getAddress(),
      registry: f.network.registry,
      provider: f.network.provider,
      signersFor: async () => ({ proposer: f.signers.A, approver: f.signers.B }),
      fromBlock: 0,
    }),
    f.protection,
  );
  await Promise.all([worker(), worker()]);
  row = (
    await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
      opened.proposal_id,
    ])
  ).rows[0];
  assert.equal(row.onchain_state, 'cancelled');
  assert.ok(row.rejection_delivered_at);
  assert.equal(row.applied_at, null);
  assert.equal(
    (
      await f.database.query('SELECT local_standing FROM registered_certificates WHERE id=$1', [
        f.certificate,
      ])
    ).rows[0].local_standing,
    'active',
  );
  const logs = await f.contract.queryFilter(
    f.contract.filters.ProposalCancelled(row.onchain_proposal_id),
  );
  const rejection = (
    await f.database.query(
      "SELECT entry_hash FROM audit_entries WHERE event='status.change_rejected' AND proposal_id=$1",
      [opened.proposal_id],
    )
  ).rows[0];
  assert.equal(logs.length, 1);
  assert.equal((logs[0] as EventLog).args.reasonHash, '0x' + rejection.entry_hash.toString('hex'));
  await worker();
  assert.equal(
    (await f.contract.queryFilter(f.contract.filters.ProposalCancelled(row.onchain_proposal_id)))
      .length,
    1,
  );
});

test('actual configured quorum, removed signer keys, external execution and expired-case release', async (context) => {
  const f = await lifecycleFixture();
  context.after(() => f.close());
  const proposals = postgresStatusProposals(f.database, { protection: f.protection });
  const tiId = await f.contract.computeTiId(f.did);
  // The unchanged contract governs its own policy; the server does not substitute two signatures.
  await (await f.contract.connect(f.supervisor).proposePolicy(tiId, 0, 3, 0, 7, 0)).wait();
  await (
    await f.contract.connect(f.keys[0]).signAdminProposal(await f.contract.adminProposalCount())
  ).wait();
  const opened = await proposals.propose(f.accounts.proposer, {
    credential_id: f.credential,
    action: 'suspend',
    reason_code: 'other',
    reason_note: 'private quorum case',
  });
  await f.deliver();
  await proposals.decide(f.accounts.mixed, opened.proposal_id, 'approved');
  await f.deliver();
  let row = (
    await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
      opened.proposal_id,
    ])
  ).rows[0];
  assert.equal(row.applied_at, null);
  assert.equal(row.onchain_state, 'proposed');
  const signed = (
    await f.database.query(
      "SELECT count(*)::int AS n FROM ledger_signing_intents WHERE contract=$1 AND contract_function='signProposal'",
      [await f.contract.getAddress()],
    )
  ).rows[0].n;
  await f.retry();
  await f.deliver();
  assert.equal(
    (
      await f.database.query(
        "SELECT count(*)::int AS n FROM ledger_signing_intents WHERE contract=$1 AND contract_function='signProposal'",
        [await f.contract.getAddress()],
      )
    ).rows[0].n,
    signed,
  );
  // Live replacement makes B's old signature cease to count. It must not be silently restored.
  const replacement = await f.network.newTiKey(f.ti);
  await (
    await f.contract
      .connect(f.supervisor)
      .proposeReplaceSigner(tiId, f.keys[1].address, replacement.address)
  ).wait();
  await (
    await f.contract.connect(f.keys[0]).signAdminProposal(await f.contract.adminProposalCount())
  ).wait();
  await f.retry();
  await f.deliver();
  row = (
    await f.database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [
      opened.proposal_id,
    ])
  ).rows[0];
  assert.equal(row.applied_at, null);
  assert.equal(row.delivery_failed, true);
  await (await f.contract.connect(replacement).signProposal(row.onchain_proposal_id)).wait();
  await (await f.contract.connect(f.supervisor).signProposal(row.onchain_proposal_id)).wait();
  await (await f.contract.connect(f.supervisor).execute(row.onchain_proposal_id)).wait();
  await f.retry();
  await f.deliver();
  assert.ok(
    (
      await f.database.query('SELECT applied_at FROM certificate_status_proposals WHERE id=$1', [
        opened.proposal_id,
      ])
    ).rows[0].applied_at,
  );
  const next = await proposals.propose(f.accounts.proposer, {
    credential_id: f.credential,
    action: 'reinstate',
  });
  await f.deliver();
  const pending = (
    await f.database.query(
      'SELECT onchain_proposal_id FROM certificate_status_proposals WHERE id=$1',
      [next.proposal_id],
    )
  ).rows[0];
  await f.network.increaseTime(Number((await f.contract.getTi(tiId)).proposalTtl) + 1);
  await f.retry();
  await f.deliver();
  const expired = (
    await f.database.query(
      'SELECT onchain_state,closed_at,applied_at FROM certificate_status_proposals WHERE id=$1',
      [next.proposal_id],
    )
  ).rows[0];
  assert.equal(expired.onchain_state, 'expired');
  assert.ok(expired.closed_at);
  assert.equal(expired.applied_at, null);
  // The original expireProposal releases the record key; no invented release method is used.
  const result = await f.governance.vote(f.accounts.proposer, {
    proposal_id: pending.onchain_proposal_id,
    vote: 'expire',
    role: 'A',
  });
  assert.equal(result.status, 200);
  assert.equal(
    await f.contract.openProposalFor(
      (await f.contract.getProposal(pending.onchain_proposal_id)).statusKey,
    ),
    0n,
  );
});
