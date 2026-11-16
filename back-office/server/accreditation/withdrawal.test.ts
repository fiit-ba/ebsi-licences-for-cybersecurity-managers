import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { postgresInvitations } from './invitations.ts';
import { postgresAccreditationWithdrawal } from './withdrawal.ts';
import { postgresOrganizationCancellations } from './cancellations.ts';
import { postgresStatusProposals } from '../lifecycle/proposals.ts';
import { postgresEmergencyDelivery } from '../lifecycle/emergency-delivery.ts';
import { issuanceProtection } from '../issuance/protection.ts';
import type { GovernanceActions } from '../lifecycle/governance.ts';

test('organization withdrawal preserves independent revocations and retries TIR, cancellation and protective delivery', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const suffix = randomUUID();
  const accounts: number[] = [];
  const organizations: string[] = [];
  const certificates: string[] = [];
  const schema = (
    await database.query(
      'INSERT INTO certificate_schemas(credential_type,name_sk) VALUES($1,$1) RETURNING id',
      ['Withdrawal' + suffix.replaceAll('-', '')],
    )
  ).rows[0].id;
  context.after(async () => {
    try {
      await database.query(
        'DELETE FROM certificate_status_proposals WHERE certificate_id=ANY($1::uuid[])',
        [certificates],
      );
      await database.query(
        'DELETE FROM certificate_emergency_suspensions WHERE certificate_id=ANY($1::uuid[])',
        [certificates],
      );
      await database.query('DELETE FROM registered_certificates WHERE id=ANY($1::uuid[])', [
        certificates,
      ]);
      await database.query(
        'DELETE FROM accreditation_withdrawals WHERE revoked_organization_id=ANY($1::uuid[])',
        [organizations],
      );
      await database.query(
        'DELETE FROM accreditation_events WHERE organization_id=ANY($1::uuid[])',
        [organizations],
      );
      await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [schema]);
      await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
      await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::integer[])', [accounts]);
    } finally {
      await database.end();
    }
  });
  for (let i = 0; i < 3; i++)
    accounts.push(
      (
        await database.query(
          'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
          [suffix + i, 'no-password'],
        )
      ).rows[0].id,
    );
  const [actor, approver, issuer] = accounts;
  await database.query(
    "INSERT INTO operator_roles VALUES($1,'plr_rtao'),($1,'plr_status_manager'),($2,'plr_status_manager')",
    [actor, approver],
  );
  for (const [index, kind] of ['rtao', 'tao', 'ti'].entries())
    organizations.push(
      (
        await database.query(
          'INSERT INTO accredited_organizations(name,kind,parent_id,account_id,did) VALUES($1,$2,$3,$4,$5) RETURNING id',
          [
            suffix + kind,
            kind,
            organizations.at(-1) ?? null,
            index === 0 ? actor : index === 2 ? issuer : null,
            'did:ebsi:z' + kind + suffix.replaceAll('-', ''),
          ],
        )
      ).rows[0].id,
    );
  const [, tao, ti] = organizations;
  await database.query(
    "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,1,'[]','test',now())",
    [schema],
  );
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    certificates.push(id);
    await database.query(
      `INSERT INTO registered_certificates(id,credential_id,issuer_id,issuer_did,schema_id,schema_version,certificate_number,status_key,credential_hash,private_data,created_by)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,
      [
        id,
        'urn:uuid:' + id,
        ti,
        'did:ebsi:zWithdrawal',
        schema,
        String(i),
        randomBytes(32),
        randomBytes(32),
        Buffer.from('test'),
        issuer,
      ],
    );
  }
  const proposals = postgresStatusProposals(database, { governanceEnabled: false });
  const retained = await proposals.propose(actor, {
    credential_id: 'urn:uuid:' + certificates[0],
    action: 'revoke',
    reason_code: 'other',
    reason_note: 'original decision',
  });
  const superseded = await proposals.propose(actor, {
    credential_id: 'urn:uuid:' + certificates[1],
    action: 'suspend',
    reason_code: 'other',
    reason_note: 'superseded',
  });
  let tirAvailable = false;
  let tirWrites = 0;
  // Revoking an accreditation in the Trusted Issuers Registry, through EBSI's Core API v1.
  const revokeInTir = async () => {
    tirWrites++;
    if (!tirAvailable) throw new Error('outage');
  };
  const withdrawal = postgresAccreditationWithdrawal(database, revokeInTir);
  const invitations = postgresInvitations(database, {
    governanceEnabled: false,
    withdraw: withdrawal.deliver,
  });
  const revoked = await invitations.revoke(actor, { organization_id: tao, reason: 'breach' });
  assert.equal(revoked.suspended, 3);
  assert.equal(revoked.revocations_proposed, 2);
  assert.ok(tirWrites > 0);
  assert.equal(
    (
      await database.query(
        'SELECT count(*)::int AS n FROM accreditation_withdrawals WHERE revoked_organization_id=$1 AND tir_completed_at IS NULL',
        [tao],
      )
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    proposals.decide(actor, retained.proposal_id, 'approved'),
    (error) => (error as any).body.reason === 'FourEyes',
  );
  assert.equal(
    (await proposals.decide(approver, retained.proposal_id, 'approved')).state,
    'revoked',
  );
  assert.equal(
    (
      await database.query('SELECT closed_at FROM certificate_status_proposals WHERE id=$1', [
        superseded.proposal_id,
      ])
    ).rows[0].closed_at instanceof Date,
    true,
  );
  tirAvailable = true;
  await database.query(
    'UPDATE accreditation_withdrawals SET attempted_at=NULL WHERE revoked_organization_id=$1',
    [tao],
  );
  await Promise.all([withdrawal.deliver(), withdrawal.deliver()]);
  assert.equal(
    (
      await database.query(
        'SELECT count(*)::int AS n FROM accreditation_withdrawals WHERE revoked_organization_id=$1 AND tir_completed_at IS NULL',
        [tao],
      )
    ).rows[0].n,
    0,
  );

  // A lost old reinstatement response is reconciled after its earlier emergency
  // was delivered. The certificate must receive a fresh protective request.
  const old = certificates[2];
  const original = (
    await database.query('SELECT * FROM certificate_status_proposals WHERE certificate_id=$1', [
      old,
    ])
  ).rows[0];
  await database.query(
    "UPDATE certificate_status_proposals SET action='reinstate',closed_at=now(),onchain_contract=$2,onchain_chain_id=1337,onchain_proposal_id='7',delivery_uncertain=true WHERE id=$1",
    [original.id, '0x' + 'ab'.repeat(20)],
  );
  await database.query(
    'INSERT INTO organization_case_cancellations(proposal_id,requested_by,reason_salt,reason_hash) VALUES($1,$2,$3,$4)',
    [original.id, actor, original.reason_salt, original.reason_hash],
  );
  let unavailable = true;
  let cancellations = 0;
  const governance: GovernanceActions = {
    chainId: 1337,
    contract: '0x' + 'ab'.repeat(20),
    advance: async () => assert.fail('No new case may be advanced by cancellation'),
    withdraw: async (record) => {
      cancellations++;
      assert.equal(record.onchainId, '7');
      if (unavailable) throw new Error('lost response');
      return { id: '7', state: 'executed' };
    },
  };
  const protection = issuanceProtection(Buffer.alloc(32, 32));
  const cancel = postgresOrganizationCancellations(database, governance, protection);
  await cancel();
  assert.equal(cancellations, 1);
  assert.equal(
    (
      await database.query(
        'SELECT completed_at FROM organization_case_cancellations WHERE proposal_id=$1',
        [original.id],
      )
    ).rows[0].completed_at,
    null,
  );
  unavailable = false;
  await database.query(
    'UPDATE organization_case_cancellations SET attempted_at=NULL WHERE proposal_id=$1',
    [original.id],
  );
  await cancel();
  assert.ok(
    (
      await database.query(
        'SELECT completed_at FROM organization_case_cancellations WHERE proposal_id=$1',
        [original.id],
      )
    ).rows[0].completed_at,
  );
  const emergency = (
    await database.query(
      'SELECT * FROM certificate_emergency_suspensions WHERE certificate_id=$1 AND applied_at IS NULL',
      [old],
    )
  ).rows[0];
  assert.ok(emergency);
  const sent: string[] = [];
  const deliver = postgresEmergencyDelivery(
    database,
    {
      chainId: 1337,
      contract: governance.contract,
      suspend: async (record) => {
        sent.push(record.reasonHash);
      },
    },
    protection,
  );
  await Promise.all([deliver(), deliver()]);
  assert.deepEqual(sent, ['0x' + emergency.reason_hash.toString('hex')]);
  assert.equal(
    (await database.query('SELECT local_standing FROM registered_certificates WHERE id=$1', [old]))
      .rows[0].local_standing,
    'suspended',
  );
});
