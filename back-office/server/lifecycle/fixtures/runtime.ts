import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { Contract } from 'ethers';
import { auditedLedgerSigner } from '../../keys/ledger-signing.ts';
import { consoleLedger } from '../console-ledger.ts';
import { postgresConsoleGovernance } from '../console-governance.ts';
import { governanceActions } from '../governance.ts';
import { postgresGovernanceDelivery } from '../delivery.ts';
import { postgresEmergencyDelivery } from '../emergency-delivery.ts';
import { emergencyLedger } from '../emergency-ledger.ts';
import { hashPassword } from '../../identity/auth/passwords.ts';
import {
  certificateIdHash,
  certificateStatusKey,
  issuanceProtection,
} from '../../issuance/protection.ts';
import { REGISTRY_ABI } from '../../../shared/governance-contract.ts';
import { testLedger, type TestPolicy } from './ledger.ts';

/** Password for synthetic lifecycle/browser accounts only. */
export const lifecyclePassword = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';

/**
 * Create real PostgreSQL lifecycle data, and a TI of its own on the test ledger's certificate
 * registry and governance contract, with one collected certificate recorded.
 * @param prefix - Synthetic account namespace, stable for browser login.
 * @param database - Optional isolated pool owned and closed by this fixture.
 * @param options - Optional policies for the fixture's TI.
 * @returns Domain adapters, the TI's local EC role keys, public IDs and cleanup.
 * @throws Assertion, database, ledger or crypto errors.
 * @remarks Real EC Wallet keys substitute KMS here; audited one-time transaction checks remain real.
 */
export async function lifecycleFixture(
  prefix = 'stage5-' + randomUUID(),
  database = new pg.Pool(),
  options: { policies?: TestPolicy[] } = {},
) {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const network = await testLedger();
  const ti = await network.newTi({ policies: options.policies });
  const keys = ti.keys;
  const supervisor = network.supervisor;
  // Tests call the contract's functions directly, as an outside signer would.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract: any = network.governanceContract;
  const address = network.governance;
  const chainId = network.chainId;
  const deployment = { governance: network.governance, registry: network.registry };
  const signers = Object.fromEntries(
    keys.map((key, index) => [
      index === 0 ? 'A' : 'B',
      auditedLedgerSigner(database, key, {
        keyId: prefix + '-key-' + key.address,
        purpose: index === 0 ? 'governance_role_a' : 'governance_role_b',
        chainId,
        deployment,
      }),
    ]),
  ) as Record<'A' | 'B', ReturnType<typeof auditedLedgerSigner>>;
  const organizations = [randomUUID(), randomUUID(), randomUUID()];
  const schema = randomUUID();
  const certificate = randomUUID();
  const credential = 'urn:uuid:' + certificate;
  const registered = 'urn:uuid:' + randomUUID();
  const did = ti.did;
  const protection = issuanceProtection(Buffer.alloc(32, 71));
  // The record's key: the TI and the collected credential's id; the hash of that credential.
  const statusKey = '0x' + certificateStatusKey(did, credential).toString('hex');
  const credentialHash = randomBytes(32);
  const accounts: Record<string, number> = {};
  const password = await hashPassword(lifecyclePassword);
  for (const suffix of ['proposer', 'second', 'mixed', 'outsider', 'auditor', 'root', 'tao']) {
    const actor = (
      await database.query(
        'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
        [prefix + '.' + suffix, password],
      )
    ).rows[0].id;
    accounts[suffix] = actor;
    const roles =
      suffix === 'auditor'
        ? ['plr_auditor']
        : suffix === 'root'
          ? ['plr_rtao']
          : suffix === 'tao'
            ? ['plr_tao']
            : suffix === 'proposer' || suffix === 'mixed'
              ? ['plr_status_manager']
              : [];
    for (const role of roles)
      await database.query('INSERT INTO operator_roles VALUES($1,$2)', [actor, role]);
    for (const role of suffix === 'proposer'
      ? ['A', 'B']
      : suffix === 'second'
        ? ['B']
        : suffix === 'mixed'
          ? ['A', 'B']
          : [])
      await database.query('INSERT INTO operator_governance_roles VALUES($1,$2)', [actor, role]);
  }
  await database.query(
    "INSERT INTO accredited_organizations(id,name,kind,account_id) VALUES($1,'Lifecycle Root','rtao',$2)",
    [organizations[0], accounts.root],
  );
  await database.query(
    "INSERT INTO accredited_organizations(id,name,kind,parent_id,account_id) VALUES($1,'Lifecycle TAO','tao',$2,$3)",
    [organizations[1], organizations[0], accounts.tao],
  );
  await database.query(
    "INSERT INTO accredited_organizations(id,name,kind,parent_id,account_id,did,tir_attribute_id,governance_configured_at) VALUES($1,'Lifecycle TI','ti',$2,$3,$4,$5,now())",
    [organizations[2], organizations[1], accounts.proposer, did, ti.attributeId],
  );
  await database.query(
    "INSERT INTO certificate_schemas(id,credential_type,name_sk) VALUES($1,$2,'Lifecycle')",
    [schema, 'Lifecycle' + schema.replaceAll('-', '')],
  );
  await database.query(
    "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,1,'[]','fixture',now())",
    [schema],
  );
  await database.query(
    `INSERT INTO registered_certificates(id,credential_id,registered_id,issuer_id,issuer_did,schema_id,schema_version,certificate_number,status_key,credential_hash,private_data,created_by,ledger_registered_at)
    VALUES($1,$2,$3,$4,$5,$6,1,'STAGE5',$7,$8,$9,$10,now())`,
    [
      certificate,
      credential,
      registered,
      organizations[2],
      did,
      schema,
      Buffer.from(statusKey.slice(2), 'hex'),
      credentialHash,
      protection.seal(certificate, {
        holder_reference: 'private-stage5-holder',
        claims: { certificateNumber: 'STAGE5', certificationBody: 'Lifecycle TI' },
      }),
      accounts.proposer,
    ],
  );
  await database.query(
    "INSERT INTO credential_tokens(token_digest,certificate_id,nonce,expires_at,redeemed_at) VALUES($1,$2,'stage5',now(),now())",
    [Buffer.from(randomUUID().replaceAll('-', '').repeat(2), 'hex'), certificate],
  );
  // Recorded by the TI's key, as collection records it.
  await (
    await new Contract(network.registry, REGISTRY_ABI, keys[0]).registerCertificate(
      '0x' + certificateIdHash(credential).toString('hex'),
      did,
      0,
      0,
      '0x' + credentialHash.toString('hex'),
      1,
    )
  ).wait();
  const actions = governanceActions({
    chainId,
    address,
    registry: network.registry,
    provider: network.provider,
    signersFor: async () => ({ proposer: signers.A, approver: signers.B }),
    fromBlock: 0,
  });
  const deliver = postgresGovernanceDelivery(database, actions, protection);
  const deliverEmergencies = postgresEmergencyDelivery(
    database,
    emergencyLedger({
      chainId,
      address: network.registry,
      provider: network.provider,
      signerFor: async () => signers.A,
      fromBlock: 0,
    }),
    protection,
  );
  const ledger = consoleLedger({
    chainId,
    address,
    registry: network.registry,
    provider: network.provider,
    signersFor: async (_issuer, role) => signers[role],
  });
  const governance = postgresConsoleGovernance(database, { ledger });
  return {
    database,
    accounts,
    organizations,
    certificate,
    credential,
    registered,
    did,
    protection,
    contract,
    keys,
    supervisor,
    signers,
    ledger,
    ti,
    credentialHash,
    governance,
    deliver,
    deliverEmergencies,
    network,
    statusKey,
    /**
     * Make pending queue entries eligible for the next bounded sweep.
     * @returns Completion after fixture-only scheduling changes.
     * @throws Database errors.
     */
    async retry() {
      await database.query(
        'UPDATE certificate_status_proposals SET delivery_attempted_at=NULL WHERE certificate_id=$1',
        [certificate],
      );
    },
    /**
     * Delete only this fixture's domain rows and close its owned pool.
     * @returns Completion after cleanup; immutable audit and consumed signature evidence remain.
     * @throws Database errors.
     */
    async close() {
      try {
        await database.query(
          'DELETE FROM certificate_emergency_suspensions WHERE certificate_id=$1',
          [certificate],
        );
        await database.query(
          'DELETE FROM organization_case_cancellations WHERE proposal_id IN (SELECT id FROM certificate_status_proposals WHERE certificate_id=$1)',
          [certificate],
        );
        await database.query('DELETE FROM certificate_status_proposals WHERE certificate_id=$1', [
          certificate,
        ]);
        await database.query('DELETE FROM registered_certificates WHERE id=$1', [certificate]);
        await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
          organizations,
        ]);
        await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [
          schema,
        ]);
        await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
        await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::int[])', [
          Object.values(accounts),
        ]);
      } finally {
        await database.end();
      }
    },
  };
}
