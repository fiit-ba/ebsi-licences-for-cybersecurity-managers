import { postgresGovernanceDelivery } from './delivery.ts';
import { postgresAudit } from '../audit/service.ts';
import { postgresEmergencySuspension, postgresPendingSuspension } from './emergency.ts';
import { postgresEmergencyDelivery } from './emergency-delivery.ts';
import type { EmergencyLedger } from './emergency-ledger.ts';
import { postgresStandingRefresh } from './standing.ts';
import type { GovernanceActions, GovernanceState } from './governance.ts';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { AbiCoder, sha256 } from 'ethers';
import pg from 'pg';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { hashPassword } from '../identity/auth/passwords.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { postgresCertificateList } from './certificates.ts';
import { postgresStatusProposals } from './proposals.ts';
import { certificateStatusKey, issuanceProtection } from '../issuance/protection.ts';

async function unexpectedWithdrawal(): Promise<never> {
  assert.fail('An unrequested withdrawal must not be submitted.');
}

test('status proposal HTTP flow preserves registry-wide lifecycle roles and organization emergency scope', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const root = randomUUID();
  const tao = randomUUID();
  const ti = randomUUID();
  const foreignRoot = randomUUID();
  const foreignTao = randomUUID();
  const schema = randomUUID();
  const certificate = randomUUID();
  const credentialId = 'urn:uuid:' + certificate;
  const issuerDid = 'did:ebsi:zLifecycle';
  const protection = issuanceProtection(Buffer.alloc(32, 39));
  // SHA-256 of the collected credential's signed JWT, as its record keeps it.
  const collectedHash = randomBytes(32);
  const prefix = 'lifecycle-' + randomUUID();
  const accounts: number[] = [];
  context.after(async () => {
    try {
      await database.query(
        'DELETE FROM certificate_emergency_suspensions WHERE certificate_id = $1',
        [certificate],
      );
      await database.query('DELETE FROM certificate_status_proposals WHERE certificate_id = $1', [
        certificate,
      ]);
      await database.query('DELETE FROM registered_certificates WHERE id = $1', [certificate]);
      await database.query('DELETE FROM accredited_organizations WHERE id = ANY($1::uuid[])', [
        [ti, tao, root, foreignTao, foreignRoot],
      ]);
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id = $1', [
        schema,
      ]);
      await database.query('DELETE FROM certificate_schemas WHERE id = $1', [schema]);
      await database.query('DELETE FROM operator_accounts WHERE id = ANY($1::integer[])', [
        accounts,
      ]);
    } finally {
      await database.end();
    }
  });
  const password = await hashPassword('lifecycle-test-password');
  const roles = {
    primary: 'plr_status_manager',
    second: 'plr_status_manager',
    outside: 'plr_status_manager',
    audit: 'plr_auditor',
    root: 'plr_rtao',
    tao: 'plr_tao',
    foreignRoot: 'plr_rtao',
    foreignTao: 'plr_tao',
    issuer: 'plr_issuer',
  };
  for (const [name, role] of Object.entries(roles)) {
    const {
      rows: [account],
    } = await database.query<{ id: number }>(
      `
      INSERT INTO operator_accounts (username, password_hash) VALUES ($1, $2) RETURNING id
    `,
      [prefix + name, password],
    );
    accounts.push(account.id);
    await database.query('INSERT INTO operator_roles VALUES ($1, $2)', [account.id, role]);
  }
  const [primary, second, outside, auditor] = accounts;
  const [, , , , rootOperator, taoOperator, foreignRootOperator, foreignTaoOperator] = accounts;
  await database.query(
    "INSERT INTO accredited_organizations (id, name, kind) VALUES ($1, 'Root', 'rtao')",
    [root],
  );
  await database.query(
    "INSERT INTO accredited_organizations (id, name, kind, parent_id) VALUES ($1, 'TAO', 'tao', $2)",
    [tao, root],
  );
  await database.query(
    `
    INSERT INTO accredited_organizations (id, name, kind, parent_id, account_id, did)
    VALUES ($1, 'TI', 'ti', $2, $3, $4)
  `,
    [ti, tao, primary, issuerDid],
  );
  await database.query('UPDATE accredited_organizations SET account_id = $2 WHERE id = $1', [
    root,
    rootOperator,
  ]);
  await database.query('UPDATE accredited_organizations SET account_id = $2 WHERE id = $1', [
    tao,
    taoOperator,
  ]);
  await database.query(
    `
    INSERT INTO accredited_organizations (id, name, kind, account_id) VALUES ($1, 'Foreign root', 'rtao', $2)
  `,
    [foreignRoot, foreignRootOperator],
  );
  await database.query(
    `
    INSERT INTO accredited_organizations (id, name, kind, parent_id, account_id) VALUES ($1, 'Foreign TAO', 'tao', $2, $3)
  `,
    [foreignTao, foreignRoot, foreignTaoOperator],
  );
  await database.query(
    `
    INSERT INTO certificate_schemas (id, credential_type, name_sk) VALUES ($1, $2, 'Test')
  `,
    [schema, 'LifecycleTest' + randomUUID().replaceAll('-', '')],
  );
  await database.query(
    `
    INSERT INTO certificate_schema_versions (schema_id, version, fields, tsr_id, registered_at)
    VALUES ($1, 1, '[]', 'test', now())
  `,
    [schema],
  );
  await database.query(
    `
    INSERT INTO registered_certificates (
      id, credential_id, issuer_id, issuer_did, schema_id, schema_version,
      certificate_number, status_key, credential_hash, private_data, created_by, ledger_standing, ledger_observed_at
    ) VALUES ($1,$2,$3,$4,$5,1,'LC-1',$6,$7,$8,$9,'active',now())
  `,
    [
      certificate,
      credentialId,
      ti,
      issuerDid,
      schema,
      // The record of the collected credential: its key and its hash.
      certificateStatusKey(issuerDid, credentialId),
      collectedHash,
      protection.seal(certificate, {
        holder_reference: 'case-LC-1',
        claims: { certificateNumber: 'LC-1', certificationBody: 'TI' },
      }),
      primary,
    ],
  );
  await database.query(
    `
    INSERT INTO credential_tokens (token_digest, certificate_id, nonce, expires_at, redeemed_at)
    VALUES ($1, $2, 'test-nonce', now(), now())
  `,
    [Buffer.alloc(32, 41), certificate],
  );

  const tokens = operatorTokens('test-only-secret-for-status-proposals');
  const bearer = new Map<number, string>();
  for (const account of accounts) bearer.set(account, (await tokens.pair({ id: account })).access);
  const server = backOfficeServer({
    accounts: postgresAccounts(database),
    tokens,
    listCertificates: postgresCertificateList(database, protection),
    statusProposals: postgresStatusProposals(database),
    emergencySuspend: postgresEmergencySuspension(database),
    audit: postgresAudit(database, protection),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (action: string, payload: unknown, actor?: number) =>
    fetch(origin + '/registry/' + action + '/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(actor ? { authorization: 'Bearer ' + bearer.get(actor) } : {}),
      },
      body: JSON.stringify(payload),
    });
  const read = async (path: string, actor: number) => {
    const response = await fetch(origin + '/registry/' + path + '/', {
      headers: { authorization: 'Bearer ' + bearer.get(actor) },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const request = {
    credential_id: credentialId,
    action: 'suspend',
    reason_code: 'other',
    reason_note: 'Evidence LC',
  };

  await context.test(
    'ordinary proposal authority is registry-wide and separate from emergency scope',
    async () => {
      assert.equal((await post('propose', request)).status, 401);
      const opened = await post('propose', request, outside);
      assert.equal(opened.status, 201);
      assert.equal(
        (await post('reject', { proposal_id: (await opened.json()).proposal_id }, outside)).status,
        200,
      );
      assert.equal((await post('propose', request, auditor)).status, 403);
      const invalid = await post('propose', { ...request, reason_note: '' }, primary);
      assert.equal(invalid.status, 400);
      assert.deepEqual((await read('certificates', second)).results[0].allowed_actions, [
        'suspend',
        'revoke',
      ]);
      assert.equal((await read('certificates', outside)).total, 1);
      assert.equal((await read('certificates', outside)).results[0].can_emergency_suspend, false);
      const issuer = accounts[8];
      assert.equal((await read('certificates', issuer)).total, 1);
      assert.deepEqual((await read('certificates', issuer)).results[0].allowed_actions, [
        'suspend',
        'revoke',
      ]);
      assert.equal((await post('propose', request, issuer)).status, 403);
      await database.query("INSERT INTO operator_roles VALUES ($1, 'plr_status_manager')", [
        foreignTaoOperator,
      ]);
      assert.equal((await read('certificates', foreignTaoOperator)).total, 1);
      const crossBranch = await post('propose', request, foreignTaoOperator);
      assert.equal(crossBranch.status, 201);
      assert.equal(
        (
          await post(
            'reject',
            { proposal_id: (await crossBranch.json()).proposal_id },
            foreignTaoOperator,
          )
        ).status,
        200,
      );
      await database.query(
        "DELETE FROM operator_roles WHERE account_id = $1 AND role = 'plr_status_manager'",
        [foreignTaoOperator],
      );
      assert.equal((await read('certificates', foreignTaoOperator)).total, 0);
      assert.deepEqual((await read('certificates', auditor)).results[0].allowed_actions, [
        'suspend',
        'revoke',
      ]);
      assert.equal(
        (await post('audit/commitment-preimage', { credential_id: credentialId })).status,
        401,
      );
      assert.equal(
        (await post('audit/commitment-preimage', { credential_id: credentialId }, primary)).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + '/registry/audit/', {
            headers: { authorization: 'Bearer ' + bearer.get(primary) },
          })
        ).status,
        403,
      );
    },
  );

  let proposalId: string;
  await context.test(
    'parallel requests create one open case and expose no reason salt',
    async () => {
      const attempts = await Promise.all([
        post('propose', request, primary),
        post('propose', request, primary),
      ]);
      assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
      proposalId = (await attempts.find((response) => response.ok)!.json()).proposal_id;
      const ownList = await read('proposals', primary);
      assert.equal(ownList.total, 1);
      assert.equal(ownList.results[0].can_approve, false);
      assert.equal(ownList.results[0].can_reject, true);
      assert.equal(ownList.results[0].approved, false);
      assert.equal(ownList.results[0].can_withdraw, false);
      assert.equal(ownList.results[0].reason_salt, undefined);
      assert.equal((await read('proposals', second)).results[0].can_approve, true);
      assert.equal((await read('proposals', outside)).total, 1);
      assert.equal((await read('proposals', outside)).results[0].can_approve, true);
      assert.equal((await read('proposals', auditor)).results[0].can_approve, true);
      assert.equal((await read('proposals', auditor)).results[0].can_reject, false);
      const row = (await read('certificates', second)).results[0];
      assert.equal(row.has_open_proposal, true);
      assert.deepEqual(row.allowed_actions, ['suspend', 'revoke']);
      const {
        rows: [stored],
      } = await database.query(
        'SELECT reason_hash, reason_salt FROM certificate_status_proposals WHERE id = $1',
        [proposalId],
      );
      const expected = sha256(
        AbiCoder.defaultAbiCoder().encode(
          ['string', 'string', 'string', 'bytes32'],
          ['PLR-REASON-V1', 'other', 'Evidence LC', stored.reason_salt],
        ),
      );
      assert.equal('0x' + stored.reason_hash.toString('hex'), expected);
    },
  );

  await context.test(
    'auditors disclose commitment and reason preimages with a recorded access trail',
    async () => {
      const commitmentResponse = await post(
        'audit/commitment-preimage',
        { credential_id: credentialId },
        auditor,
      );
      assert.equal(commitmentResponse.status, 200);
      const preimage = await commitmentResponse.json();
      // What the record key is computed from: the TI and the collected credential's id.
      assert.deepEqual(preimage, {
        issuer_did: issuerDid,
        certificate_id: credentialId,
        certificate_number: 'LC-1',
        status_key: '0x' + certificateStatusKey(issuerDid, credentialId).toString('hex'),
      });
      const reasonResponse = await post(
        'audit/reason-preimage',
        { proposal_id: proposalId },
        auditor,
      );
      assert.equal(reasonResponse.status, 200);
      const reason = await reasonResponse.json();
      assert.equal(reason.reason_code, 'other');
      assert.equal(reason.reason_note, 'Evidence LC');
      assert.equal(
        reason.reason_hash,
        sha256(
          AbiCoder.defaultAbiCoder().encode(
            ['string', 'string', 'string', 'bytes32'],
            ['PLR-REASON-V1', reason.reason_code, reason.reason_note, reason.salt],
          ),
        ).slice(2),
      );
      await database.query(
        "UPDATE certificate_status_proposals SET reason_note = 'Changed after commitment' WHERE id = $1",
        [proposalId],
      );
      const mismatched = await post('audit/reason-preimage', { proposal_id: proposalId }, auditor);
      assert.equal(mismatched.status, 409);
      assert.equal((await mismatched.json()).reason, 'ReasonMismatch');
      await database.query(
        "UPDATE certificate_status_proposals SET reason_note = 'Evidence LC' WHERE id = $1",
        [proposalId],
      );
      const auditResponse = await fetch(
        origin + '/registry/audit/?credential_id=' + encodeURIComponent(credentialId),
        {
          headers: { authorization: 'Bearer ' + bearer.get(auditor) },
        },
      );
      assert.equal(auditResponse.status, 200);
      const audit = await auditResponse.json();
      assert.equal(audit.chain_intact, true);
      const rows = audit.results.filter((row) => row.credential_id === credentialId);
      assert.ok(rows.some((row) => row.event === 'audit.preimage_disclosed'));
      assert.ok(rows.some((row) => row.event === 'audit.reason_disclosed'));
      const serialized = JSON.stringify(rows);
      assert.equal(serialized.includes(reason.salt.slice(2)), false);
      // The journal records that the identifier was disclosed, never the identifier's key inputs.
      assert.equal(serialized.includes(preimage.status_key.slice(2)), false);
      assert.equal(serialized.includes('Evidence LC'), false);
      assert.equal(serialized.includes('case-LC-1'), false);
      await database.query('DELETE FROM operator_roles WHERE account_id = $1', [auditor]);
      assert.equal(
        (await post('audit/reason-preimage', { proposal_id: proposalId }, auditor)).status,
        403,
      );
      await database.query("INSERT INTO operator_roles VALUES ($1,'plr_auditor')", [auditor]);
    },
  );

  await context.test(
    'self approval fails and concurrent rejection closes a case even after independent approval',
    async () => {
      const body = { proposal_id: proposalId };
      const self = await post('approve', body, primary);
      assert.equal(self.status, 403);
      assert.equal((await self.json()).reason, 'FourEyes');
      assert.equal((await post('approve', body, auditor)).status, 403);
      const race = await Promise.all([
        post('approve', body, outside),
        post('reject', body, second),
      ]);
      assert.equal(race[1].status, 200);
      assert.ok([200, 403].includes(race[0].status));
      const decisions = await Promise.all(race.map((response) => response.json()));
      const winner =
        decisions.find((body) => body.rejected) ??
        decisions.find((body) => body.applied !== undefined);
      if (winner.rejected) {
        const next = await post('propose', request, primary);
        assert.equal(next.status, 201);
        proposalId = (await next.json()).proposal_id;
        const approval = await post('approve', { proposal_id: proposalId }, second);
        assert.equal(approval.status, 200);
        assert.equal((await approval.json()).applied, false);
      } else {
        assert.equal(winner.applied, false);
        assert.equal(winner.awaiting, 'governance contract');
      }
      const approved = (await read('proposals', primary)).results[0];
      assert.equal(approved.approved, true);
      assert.equal(approved.can_withdraw, true);
      const certificateRow = (await read('certificates', primary)).results[0];
      assert.equal(certificateRow.state, 'active');
      assert.equal(certificateRow.has_open_proposal, true);
      assert.equal((await read('proposals', second)).results[0].can_reject, true);
    },
  );

  await context.test(
    'removing a live role immediately removes ordinary lifecycle authority',
    async () => {
      assert.equal((await read('proposals', second)).total, 1);
      assert.equal((await read('certificates', second)).total, 1);
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      await database.query(
        "DELETE FROM operator_roles WHERE account_id = $1 AND role = 'plr_status_manager'",
        [second],
      );
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 403);
      await database.query("INSERT INTO operator_roles VALUES ($1, 'plr_status_manager')", [
        second,
      ]);
    },
  );

  await context.test(
    'an old ledger observation does not hide local state or bypass an existing open case',
    async () => {
      await database.query(
        "UPDATE registered_certificates SET ledger_observed_at = now() - interval '10 minutes' WHERE id = $1",
        [certificate],
      );
      assert.deepEqual((await read('certificates', primary)).results[0].allowed_actions, [
        'suspend',
        'revoke',
      ]);
      const refused = await post('propose', request, primary);
      assert.equal(refused.status, 409);
      assert.match((await refused.json()).detail, /already has an open proposal/);
    },
  );
  await context.test(
    'governance delivery persists deployment identity and retries until execution',
    async () => {
      let attempts = 0;
      let chainState: GovernanceState = 'approved';
      const governance: GovernanceActions = {
        chainId: 1337,
        contract: '0x' + 'ab'.repeat(20),
        withdraw: unexpectedWithdrawal,
        async advance(proposal) {
          attempts++;
          assert.equal(proposal.credentialId, credentialId);
          assert.equal(proposal.issuerDid, issuerDid);
          if (attempts === 1) throw new Error('RPC lost the response');
          if (attempts === 2) assert.equal(proposal.onchainId, null);
          else assert.equal(proposal.onchainId, '55');
          return { id: '55', state: chainState };
        },
      };
      const deliver = postgresGovernanceDelivery(database, governance, protection);
      const readyToRetry = () =>
        database.query(
          `
      UPDATE certificate_status_proposals SET delivery_attempted_at = clock_timestamp() - interval '30 seconds'
      WHERE id = $1
    `,
          [proposalId],
        );
      await Promise.all([deliver(), deliver()]);
      assert.equal(attempts, 1);
      const {
        rows: [failed],
      } = await database.query('SELECT * FROM certificate_status_proposals WHERE id = $1', [
        proposalId,
      ]);
      assert.equal(failed.delivery_failed, true);
      assert.equal(failed.onchain_contract, governance.contract);
      assert.equal(failed.applied_at, null);
      assert.equal(failed.onchain_proposal_id, null);

      await readyToRetry();
      await deliver();
      const waiting = await read('proposals', primary);
      assert.equal(waiting.results[0].onchain_proposal_id, '55');
      assert.equal(waiting.results[0].onchain_state, 'approved');
      assert.equal(waiting.results[0].approved, true);
      assert.equal((await read('certificates', primary)).results[0].has_open_proposal, true);

      await readyToRetry();
      let switched = false;
      const wrongDeployment = postgresGovernanceDelivery(
        database,
        {
          ...governance,
          contract: '0x' + 'cd'.repeat(20),
          async advance() {
            switched = true;
            throw new Error('Must not run');
          },
        },
        protection,
      );
      await wrongDeployment();
      assert.equal(switched, false);
      const {
        rows: [pinned],
      } = await database.query(
        'SELECT onchain_contract FROM certificate_status_proposals WHERE id = $1',
        [proposalId],
      );
      assert.equal(pinned.onchain_contract, governance.contract);

      chainState = 'executed';
      await readyToRetry();
      await Promise.all([deliver(), deliver()]);
      assert.equal(attempts, 3);
      assert.equal((await read('proposals', primary)).total, 0);
      const after = (await read('certificates', primary)).results[0];
      assert.equal(after.has_open_proposal, false);
      assert.equal(after.state, 'suspended');
      await deliver();
      assert.equal(attempts, 3);
    },
  );

  await context.test(
    'a governance veto closes the approved case without applying a transition',
    async () => {
      await database.query(
        `
      UPDATE registered_certificates SET local_standing = 'active', ledger_standing = 'active', ledger_observed_at = clock_timestamp() WHERE id = $1
    `,
        [certificate],
      );
      const proposed = await post('propose', request, primary);
      assert.equal(proposed.status, 201);
      proposalId = (await proposed.json()).proposal_id;
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      const deliver = postgresGovernanceDelivery(
        database,
        {
          chainId: 1337,
          contract: '0x' + 'ab'.repeat(20),
          withdraw: unexpectedWithdrawal,
          async advance() {
            return { id: '56', state: 'cancelled' };
          },
        },
        protection,
      );
      await deliver();
      const {
        rows: [closed],
      } = await database.query(
        'SELECT applied_at, closed_at FROM certificate_status_proposals WHERE id = $1',
        [proposalId],
      );
      assert.equal(closed.applied_at, null);
      assert.ok(closed.closed_at);
      assert.equal((await read('proposals', primary)).total, 0);
      const remaining = (await read('certificates', primary)).results[0];
      assert.equal(remaining.state, 'active');
      assert.equal(remaining.has_open_proposal, false);
      const nextProposal = await post('propose', request, primary);
      assert.equal(nextProposal.status, 201);
      proposalId = (await nextProposal.json()).proposal_id;
    },
  );

  await context.test(
    'emergency scope, concurrent requests and durable delivery protect the certificate immediately',
    async () => {
      const emergencyRequest = {
        credential_id: credentialId,
        reason_code: 'key_compromise',
        reason_note: 'Incident LC',
      };
      const suspended = postgresPendingSuspension(database);
      assert.equal((await post('emergency-suspend', emergencyRequest)).status, 401);
      for (const actor of [outside, second, auditor, foreignTaoOperator]) {
        assert.equal((await post('emergency-suspend', emergencyRequest, actor)).status, 403);
      }
      assert.equal((await read('certificates', foreignRootOperator)).total, 1);
      assert.equal(
        (await read('certificates', foreignRootOperator)).results[0].can_emergency_suspend,
        true,
      );
      assert.equal((await read('certificates', foreignTaoOperator)).total, 0);
      assert.equal(
        (await read('certificates', rootOperator)).results[0].can_emergency_suspend,
        true,
      );
      assert.equal(
        (await read('certificates', taoOperator)).results[0].can_emergency_suspend,
        true,
      );
      assert.equal((await read('certificates', auditor)).results[0].can_emergency_suspend, false);
      assert.equal(
        (await post('emergency-suspend', { ...emergencyRequest, reason_code: 'invalid' }, primary))
          .status,
        400,
      );
      const parallel = await Promise.all([
        post('emergency-suspend', emergencyRequest, primary),
        post('emergency-suspend', emergencyRequest, primary),
      ]);
      assert.deepEqual(parallel.map((response) => response.status).sort(), [200, 409]);
      const response = await parallel.find((response) => response.ok)!.json();
      assert.equal(response.state, 'suspended');
      assert.equal(response.awaiting, 'governance contract');
      const emergencyReason = await post(
        'audit/reason-preimage',
        { kind: 'emergency', emergency_id: response.emergency_id },
        auditor,
      );
      assert.equal(emergencyReason.status, 200);
      assert.equal((await emergencyReason.json()).reason_note, 'Incident LC');
      const current = (await read('certificates', primary)).results[0];
      assert.equal(current.state, 'suspended');
      assert.equal(current.can_emergency_suspend, true);
      assert.deepEqual(current.allowed_actions, ['reinstate', 'revoke']);
      assert.equal(await suspended(issuerDid, credentialId), true);
      assert.equal(await suspended('did:ebsi:zWrong', credentialId), false);
      assert.equal(await suspended(issuerDid, 'urn:uuid:unknown'), false);
      assert.equal((await read('proposals', second)).results[0].can_approve, true);
      assert.equal(
        (
          await post(
            'propose',
            { ...request, action: 'reinstate', reason_code: 'resolved' },
            primary,
          )
        ).status,
        409,
      );

      let attempts = 0;
      const ledger: EmergencyLedger = {
        chainId: 1337,
        contract: '0x' + 'ab'.repeat(20),
        async suspend(record) {
          attempts++;
          assert.equal(record.credentialId, credentialId);
          assert.equal(record.issuerDid, issuerDid);
          assert.equal(record.credentialHash, '0x' + collectedHash.toString('hex'));
          if (attempts === 1) throw new Error('Temporary ledger failure');
        },
      };
      const deliver = postgresEmergencyDelivery(database, ledger, protection);
      const retry = () =>
        database.query(
          `
      UPDATE certificate_emergency_suspensions SET delivery_attempted_at = now() - interval '1 minute' WHERE id = $1
    `,
          [response.emergency_id],
        );
      await deliver();
      assert.equal(attempts, 1);
      assert.equal(await suspended(issuerDid, credentialId), true);
      const {
        rows: [pending],
      } = await database.query('SELECT * FROM certificate_emergency_suspensions WHERE id = $1', [
        response.emergency_id,
      ]);
      assert.equal(pending.delivery_failed, true);
      assert.equal(pending.applied_at, null);
      assert.equal(pending.onchain_contract, ledger.contract);
      assert.equal(
        '0x' + pending.reason_hash.toString('hex'),
        sha256(
          AbiCoder.defaultAbiCoder().encode(
            ['string', 'string', 'string', 'bytes32'],
            ['PLR-REASON-V1', 'key_compromise', 'Incident LC', pending.reason_salt],
          ),
        ),
      );
      await retry();
      let switched = false;
      await postgresEmergencyDelivery(
        database,
        {
          ...ledger,
          chainId: 1338,
          async suspend() {
            switched = true;
          },
        },
        protection,
      )();
      assert.equal(switched, false);
      assert.equal(await suspended(issuerDid, credentialId), true);
      // A refresh started before confirmation must not resurrect its old
      // active observation after the worker invalidates standing.
      await database.query(
        'UPDATE registered_certificates SET ledger_standing = NULL, ledger_observed_at = NULL WHERE id = $1',
        [certificate],
      );
      let readStarted: () => void;
      const started = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      let release: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refresh = postgresStandingRefresh(database, {
        async status(key) {
          if (key === '0x' + certificateStatusKey(issuerDid, credentialId).toString('hex')) {
            readStarted();
            await blocked;
          }
          return {
            standing: 1n,
            issuerDid,
            credentialHash: '0x' + collectedHash.toString('hex'),
            validFrom: 0n,
            validUntil: 0n,
          };
        },
      })();
      await started;
      await retry();
      // Removing requester access after acceptance does not undo the incident.
      await database.query('UPDATE operator_accounts SET active = false WHERE id = $1', [primary]);
      await database.query(
        "UPDATE accredited_organizations SET revoked_at = now(), revocation_reason = 'test' WHERE id = $1",
        [tao],
      );
      await Promise.all([deliver(), deliver()]);
      assert.equal(attempts, 2);
      release();
      await refresh;
      assert.equal(await suspended(issuerDid, credentialId), false);
      const {
        rows: [observation],
      } = await database.query(
        'SELECT ledger_standing, ledger_observed_at FROM registered_certificates WHERE id = $1',
        [certificate],
      );
      assert.equal(observation.ledger_standing, null);
      assert.equal(observation.ledger_observed_at, null);
      await deliver();
      assert.equal(attempts, 2);
      await database.query('UPDATE operator_accounts SET active = true WHERE id = $1', [primary]);
      await database.query(
        'UPDATE accredited_organizations SET revoked_at = NULL, revocation_reason = NULL WHERE id = $1',
        [tao],
      );

      // All three authorized scopes can request a later emergency after an
      // independently observed reinstatement. Each gets a new reason salt.
      for (const actor of [foreignRootOperator, taoOperator, rootOperator]) {
        await database.query(
          "UPDATE registered_certificates SET local_standing = 'active', ledger_standing = 'active', ledger_observed_at = now() WHERE id = $1",
          [certificate],
        );
        assert.equal((await post('emergency-suspend', emergencyRequest, actor)).status, 200);
        await deliver();
        assert.equal(await suspended(issuerDid, credentialId), false);
      }
      const {
        rows: [history],
      } = await database.query(
        `
      SELECT count(*)::integer AS total, count(DISTINCT reason_hash)::integer AS reasons
      FROM certificate_emergency_suspensions WHERE certificate_id = $1
    `,
        [certificate],
      );
      assert.deepEqual(history, { total: 4, reasons: 4 });
      await database.query(
        "UPDATE registered_certificates SET local_standing = 'active', ledger_standing = 'active', ledger_observed_at = now() WHERE id = $1",
        [certificate],
      );
    },
  );

  await context.test(
    'approved cases can be withdrawn locally or stopped on chain without reporting premature cancellation',
    async () => {
      const body = { proposal_id: proposalId, reason_note: 'Evidence corrected' };
      assert.equal((await post('withdraw', body, primary)).status, 409);
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      assert.equal((await post('withdraw', { ...body, reason_note: '' }, outside)).status, 400);
      assert.equal((await post('withdraw', body, auditor)).status, 403);
      assert.equal((await post('withdraw', { ...body, reason_note: '' }, primary)).status, 400);
      const local = await post('withdraw', body, primary);
      assert.equal(local.status, 200);
      assert.deepEqual(await local.json(), { proposal_id: proposalId, withdrawn: true });
      assert.equal((await read('proposals', primary)).total, 0);
      const next = await post('propose', request, primary);
      assert.equal(next.status, 201);
      proposalId = (await next.json()).proposal_id;
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      let advances = 0;
      let cancellations = 0;
      let finalState: GovernanceState = 'cancelled';
      const governance: GovernanceActions = {
        chainId: 1337,
        contract: '0x' + 'ab'.repeat(20),
        async advance() {
          advances++;
          return { id: String(90 + advances), state: 'approved' };
        },
        async withdraw(proposal, hash) {
          cancellations++;
          assert.equal(proposal.credentialId, credentialId);
          const {
            rows: [reason],
          } = await database.query(
            `
          SELECT withdrawal_note, withdrawal_salt, withdrawal_hash FROM certificate_status_proposals WHERE id = $1
        `,
            [proposalId],
          );
          assert.equal(hash, '0x' + reason.withdrawal_hash.toString('hex'));
          assert.equal(
            hash,
            sha256(
              AbiCoder.defaultAbiCoder().encode(
                ['string', 'string', 'string', 'bytes32'],
                ['PLR-REASON-V1', 'withdrawn', reason.withdrawal_note, reason.withdrawal_salt],
              ),
            ),
          );
          if (cancellations === 1) throw new Error('Cancellation RPC unavailable');
          return { id: proposal.onchainId!, state: finalState };
        },
      };
      const deliver = postgresGovernanceDelivery(database, governance, protection);
      await deliver();
      assert.equal(advances, 1);
      const onchain = await post('withdraw', { ...body, proposal_id: proposalId }, second);
      assert.equal(onchain.status, 200);
      assert.equal((await onchain.json()).withdrawal_requested, true);
      const withdrawalReason = await post(
        'audit/reason-preimage',
        { kind: 'withdrawal', proposal_id: proposalId },
        auditor,
      );
      assert.equal(withdrawalReason.status, 200);
      assert.equal((await withdrawalReason.json()).reason_code, 'withdrawn');
      const pending = (await read('proposals', primary)).results[0];
      assert.equal(pending.withdrawal_pending, true);
      assert.equal(pending.can_withdraw, false);
      assert.equal(pending.withdrawal_salt, undefined);
      assert.equal(
        (await post('withdraw', { ...body, proposal_id: proposalId }, primary)).status,
        409,
      );
      await deliver();
      assert.equal(advances, 1);
      assert.equal(cancellations, 1);
      assert.equal((await read('proposals', primary)).total, 1);
      await database.query(
        `
      UPDATE certificate_status_proposals SET delivery_attempted_at = now() - interval '1 minute' WHERE id = $1
    `,
        [proposalId],
      );
      await database.query(
        "UPDATE accredited_organizations SET revoked_at = now(), revocation_reason = 'test' WHERE id = $1",
        [tao],
      );
      await deliver();
      assert.equal(cancellations, 2);
      const {
        rows: [cancelled],
      } = await database.query(
        `
      SELECT applied_at, closed_at, withdrawal_completed_at, onchain_state FROM certificate_status_proposals WHERE id = $1
    `,
        [proposalId],
      );
      assert.equal(cancelled.applied_at, null);
      assert.ok(cancelled.closed_at);
      assert.ok(cancelled.withdrawal_completed_at);
      assert.equal(cancelled.onchain_state, 'cancelled');
      await database.query(
        'UPDATE accredited_organizations SET revoked_at = NULL, revocation_reason = NULL WHERE id = $1',
        [tao],
      );
      assert.equal((await read('proposals', primary)).total, 0);
      assert.equal((await read('certificates', primary)).results[0].state, 'active');

      // An external execution may win the race. Record what the chain actually
      // did instead of claiming that a cancellation succeeded.
      const racing = await post('propose', request, primary);
      proposalId = (await racing.json()).proposal_id;
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      await deliver();
      assert.equal(
        (await post('withdraw', { ...body, proposal_id: proposalId }, primary)).status,
        200,
      );
      finalState = 'executed';
      await deliver();
      const {
        rows: [executed],
      } = await database.query(
        `
      SELECT applied_at, withdrawal_completed_at, onchain_state FROM certificate_status_proposals WHERE id = $1
    `,
        [proposalId],
      );
      assert.ok(executed.applied_at);
      assert.equal(executed.withdrawal_completed_at, null);
      assert.equal(executed.onchain_state, 'executed');
      assert.equal(advances, 2);
      assert.equal((await read('certificates', primary)).results[0].state, 'suspended');
      await database.query(
        "UPDATE registered_certificates SET local_standing = 'active', ledger_standing = 'active', ledger_observed_at = now() WHERE id = $1",
        [certificate],
      );
      const last = await post('propose', request, primary);
      assert.equal(last.status, 201);
      proposalId = (await last.json()).proposal_id;
    },
  );

  await context.test(
    'issuer revocation blocks delivery of an approved reinstatement or suspension',
    async () => {
      assert.equal((await post('approve', { proposal_id: proposalId }, second)).status, 200);
      await database.query(
        `
      UPDATE accredited_organizations SET revoked_at = now(), revocation_reason = 'breach' WHERE id = $1
    `,
        [tao],
      );
      let called = false;
      const deliver = postgresGovernanceDelivery(
        database,
        {
          chainId: 1337,
          contract: '0x' + 'ab'.repeat(20),
          withdraw: unexpectedWithdrawal,
          async advance() {
            called = true;
            return { id: '57', state: 'executed' };
          },
        },
        protection,
      );
      await deliver();
      assert.equal(called, false);
      const {
        rows: [pending],
      } = await database.query(
        'SELECT applied_at, delivery_failed FROM certificate_status_proposals WHERE id = $1',
        [proposalId],
      );
      assert.equal(pending.applied_at, null);
      assert.equal(pending.delivery_failed, true);
      await database.query(
        "UPDATE registered_certificates SET local_standing = 'suspended', ledger_standing = 'suspended', ledger_observed_at = now() WHERE id = $1",
        [certificate],
      );
      const reinstate = await post(
        'propose',
        {
          ...request,
          action: 'reinstate',
          reason_code: 'resolved',
        },
        outside,
      );
      assert.equal(reinstate.status, 409);
      assert.match((await reinstate.json()).detail, /revoked; it cannot be reinstated/);
      assert.equal((await read('certificates', outside)).results[0].state, 'suspended');
      await database.query(
        "UPDATE registered_certificates SET local_standing='active' WHERE id=$1",
        [certificate],
      );
      const emergency = await post(
        'emergency-suspend',
        {
          credential_id: credentialId,
          reason_code: 'key_compromise',
          reason_note: 'Already withdrawn',
        },
        foreignRootOperator,
      );
      assert.equal(emergency.status, 200);
    },
  );

  await context.test(
    'the audit API paginates a certificate history without exposing secrets or duplicate execution events',
    async () => {
      const history = async (query: Record<string, string>) => {
        const response = await fetch(
          origin +
            '/registry/audit/?' +
            new URLSearchParams({ credential_id: credentialId, ...query }),
          {
            headers: { authorization: 'Bearer ' + bearer.get(auditor) },
          },
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      const all = await history({ limit: '500' });
      assert.equal(all.chain_intact, true);
      assert.ok(all.results.length > 20);
      assert.equal(
        all.results.every((row) => row.credential_id === credentialId),
        true,
      );
      assert.equal(
        all.results.filter((row) => row.event === 'status.emergency_suspension').length,
        5,
      );
      assert.equal(
        all.results.filter((row) => row.event === 'status.emergency_confirmed').length,
        4,
      );
      const applied = all.results.filter((row) => row.event === 'status.change_applied');
      assert.ok(applied.length >= 2);
      assert.equal(new Set(applied.map((row) => row.proposal_id)).size, applied.length);
      assert.equal(all.results.filter((row) => row.event === 'status.change_withdrawn').length, 1);
      for (const privateText of ['Evidence LC', 'Incident LC', 'Evidence corrected', 'case-LC-1']) {
        assert.equal(JSON.stringify(all.results).includes(privateText), false);
      }
      const page = await history({ limit: '2' });
      assert.equal(page.results.length, 2);
      assert.ok(page.next);
      const next = await history({ limit: '2', before_id: page.next });
      assert.equal(next.results.length, 2);
      assert.equal(
        next.results.every((row) => BigInt(row.id) < BigInt(page.next)),
        true,
      );
      assert.equal(new Set([...page.results, ...next.results].map((row) => row.id)).size, 4);
      const badCursor = await fetch(origin + '/registry/audit/?before_id=9223372036854775808', {
        headers: { authorization: 'Bearer ' + bearer.get(auditor) },
      });
      assert.equal(badCursor.status, 400);
    },
  );
});
