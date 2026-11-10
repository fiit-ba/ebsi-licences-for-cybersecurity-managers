import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { hashPassword } from '../identity/auth/passwords.ts';
import { postgresInvitations } from './invitations.ts';
import { issuerAttributes } from './registry.ts';
import { postgresOrganizationOnboarding } from './onboarding.ts';
import { postgresAccreditation } from './revalidation.ts';
import { kmsHttpFixture } from '../keys/fixtures/kms-http.ts';
import { kmsKeyCeremony } from '../keys/kms-provider.ts';
import { postgresKeyManagement } from '../keys/management.ts';
import { didRegistry } from '../ebsi/did-registry.ts';
import { trustedSchemaRegistry } from '../schemas/tsr.ts';
import { postgresSchemaManagement } from '../schemas/management.ts';
import { accreditationSchemaId, synchronizeSchemas } from '../schemas/publication.ts';
import { configuredOrganizations } from './runtime.ts';
import { postgresSchemaCatalog } from '../schemas/catalog.ts';
import { postgresIssuanceSchemes } from '../issuance/schemes.ts';
import { ebsiIssuerTrust } from '../issuance/ebsi-trust.ts';
import { postgresStatusProposals } from '../lifecycle/proposals.ts';
import { testLedger } from '../lifecycle/fixtures/ledger.ts';

test(
  'real development DID/TIR/TSR: publication, TI keys, delegated versions, expiry and branch revocation',
  { skip: !process.env.BACK_OFFICE_TEST_EBSI_URL },
  async (context) => {
    assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
    const database = new pg.Pool();
    const base = process.env.BACK_OFFICE_TEST_EBSI_URL!;
    const network = await testLedger();
    const tirUrl = base + '/v1/issuers-registry';
    const didRegistryUrl = base + '/v1/did-registry/identifiers';
    const schemas = trustedSchemaRegistry(base + '/v1/schemas-registry');
    const prefix = randomUUID().replaceAll('-', '');
    const type = 'StageTwo' + prefix + 'Certificate';
    const registryDid = 'did:ebsi:zRegistry' + prefix.replace(/[0]/g, '1');
    const trust = ebsiIssuerTrust({ tirUrl, didRegistryUrl, trustedRoots: ['did:ebsi:zSupport'] });
    const kms = await kmsHttpFixture();
    // AWS clients read credentials from the process, as in production; this file runs alone.
    process.env.AWS_ACCESS_KEY_ID = 'fixture-only';
    process.env.AWS_SECRET_ACCESS_KEY = 'fixture-only';
    // The production composition over EBSI's Core API v1, signing through the KMS protocol.
    const runtime = configuredOrganizations(database, schemas, {
      DID: registryDid,
      PLR_EBSI_MOCK_URL: base,
      PLR_EBSI_URL: base,
      PLR_TIR_URL: tirUrl,
      PLR_DIDR_URL: didRegistryUrl,
      PLR_TRUSTED_ROOT_DIDS: 'did:ebsi:zSupport',
      PLR_LEDGER_RPC_URL: base + '/v1/ledger',
      PLR_LEDGER_CHAIN_ID: String(network.chainId),
      AWS_REGION: 'eu-central-1',
      PLR_KMS_ENDPOINT_URL: kms.origin,
    });
    // Keys are created in process, so a lost response is not retried by the SDK.
    const onboarding = postgresOrganizationOnboarding(database, {
      keys: kmsKeyCeremony(kms.client),
      publication: {
        ebsi: runtime.ebsi!,
        tirUrl,
        accreditationSchema: schemas.address(accreditationSchemaId),
      },
      schemaAddress: schemas.address,
    });
    const accreditation = postgresAccreditation(database, {
      issuerDid: registryDid,
      tirUrl,
      schemaAddress: schemas.address,
      check: trust.ensureAccredited,
    });
    const management = postgresSchemaManagement(database, schemas, runtime.schemaOptions);
    const invitations = postgresInvitations(database, {
      onboard: onboarding.onboard,
      refresh: onboarding.refresh,
      withdraw: runtime.withdrawals.deliver,
      governanceEnabled: false,
    });
    const accounts: number[] = [];
    const organizations: string[] = [];
    const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
    const initialGroups = (await database.query('SELECT id FROM operator_groups')).rows.map(
      (row) => row.id,
    );
    const tokens = operatorTokens('registry-live-' + prefix + '-'.repeat(32));
    const server = backOfficeServer({
      accounts: postgresAccounts(database),
      tokens,
      invitations,
      schemaManagement: management,
      schemaCatalog: postgresSchemaCatalog(database),
      issuanceSchemes: postgresIssuanceSchemes(database),
      accreditation,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    context.after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const members = (
        await database.query(
          'SELECT account_id FROM accredited_organizations WHERE id=ANY($1::uuid[])',
          [organizations],
        )
      ).rows
        .map((row) => row.account_id)
        .filter(Boolean);
      for (const table of ['certificate_status_proposals', 'certificate_emergency_suspensions'])
        await database.query(
          `DELETE FROM ${table} WHERE certificate_id IN (SELECT id FROM registered_certificates WHERE issuer_id=ANY($1::uuid[]))`,
          [organizations],
        );
      await database.query('DELETE FROM registered_certificates WHERE issuer_id=ANY($1::uuid[])', [
        organizations,
      ]);
      await database.query(
        'DELETE FROM organization_key_requests WHERE organization_id=ANY($1::uuid[])',
        [organizations],
      );
      await database.query(
        'DELETE FROM signing_key_provisions WHERE organization_id=ANY($1::uuid[])',
        [organizations],
      );
      await database.query(
        'DELETE FROM issuer_signing_keys WHERE organization_id=ANY($1::uuid[])',
        [organizations],
      );
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
      await database.query('DELETE FROM schema_events WHERE credential_type=$1', [type]);
      await database.query(
        'DELETE FROM certificate_schema_versions WHERE schema_id IN(SELECT id FROM certificate_schemas WHERE credential_type=$1)',
        [type],
      );
      await database.query('DELETE FROM certificate_schemas WHERE credential_type=$1', [type]);
      await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::integer[])', [
        [...accounts, ...members],
      ]);
      await database.query(
        'DELETE FROM operator_groups WHERE NOT(id=ANY($1::integer[])) AND NOT EXISTS(SELECT 1 FROM operator_account_groups g WHERE g.group_id=operator_groups.id)',
        [initialGroups],
      );
      await database.query(
        'DELETE FROM issuer_accreditation_checks WHERE issuer_did=$1 OR credential_type=$2',
        [registryDid, type],
      );
      await database.end();
      runtime.close();
      await kms.close();
    });
    const actor = (
      await database.query(
        'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
        ['registry.' + prefix, await hashPassword(password)],
      )
    ).rows[0].id;
    accounts.push(actor);
    await database.query("INSERT INTO operator_roles VALUES($1,'plr_rtao')", [actor]);
    organizations.push(
      (
        await database.query(
          "INSERT INTO accredited_organizations(name,kind,account_id) VALUES('Registry test root','rtao',$1) RETURNING id",
          [actor],
        )
      ).rows[0].id,
    );
    const rootToken = (await tokens.pair({ id: actor, username: 'registry.' + prefix })).access;
    const request = async (path: string, body?: unknown, token = rootToken) => {
      const result = await fetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: result.status, body: await result.json() };
    };
    const field = {
      key: 'number',
      kind: 'text',
      section: 'certificate',
      label: { sk: 'Číslo', en: 'Number' },
      hint: { sk: '', en: '' },
      required: true,
      organization: false,
      default: '',
    };
    const published = await request('/registry/schemas/', {
      credential_type: type,
      name_sk: 'Oprávnenie',
      fields: [field],
    });
    assert.equal(published.status, 201, JSON.stringify(published.body));
    assert.equal(published.body.current_version, 1);
    assert.equal(
      (await schemas.document(published.body.versions[0].schema_address)).properties
        .credentialSubject.required[0],
      'id',
    );
    const tao = await invitations.select(actor, { name: 'Live registry TAO', schemas: [type] });
    organizations.push(tao.organization_id);
    await invitations.register({ invitation: tao.invitation, username: 'tao.' + prefix, password });
    const taoAccount = (
      await database.query('SELECT account_id FROM accredited_organizations WHERE id=$1', [
        tao.organization_id,
      ])
    ).rows[0].account_id;
    await assert.rejects(
      postgresInvitations(database, { maxAccreditationDays: 1 }).select(taoAccount, {
        name: 'Too long',
        accredited_until: new Date(Date.now() + 2 * 86400000).toISOString(),
      }),
      (error) =>
        (error as any).body.reason === 'LifespanTooLong' && (error as any).body.codes[0] === '1',
    );
    const ti = await invitations.select(taoAccount, {
      name: 'Live registry TI',
      schemas: [type],
      accredited_until: new Date(Date.now() + 86400000).toISOString(),
    });
    organizations.push(ti.organization_id);
    const registered = await request('/organizations/v1/registrations/', {
      invitation: ti.invitation,
      username: 'ti.' + prefix,
      password,
      kind: 'ti',
    });
    assert.equal(registered.status, 201);
    let issuer = (
      await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [
        ti.organization_id,
      ])
    ).rows[0];
    assert.ok(
      issuer.did && issuer.tir_attribute_id,
      'the automatic post-registration attempt must actually complete',
    );
    // The RootTAO and TAO get three keys each on the way, the TI five.
    assert.equal(kms.state.creates, 11);
    await Promise.all(Array.from({ length: 12 }, () => onboarding.onboard(ti.organization_id)));
    assert.equal(kms.state.creates, 11);
    const keys = (
      await database.query('SELECT * FROM issuer_signing_keys WHERE organization_id=$1', [
        ti.organization_id,
      ])
    ).rows;
    assert.equal(new Set(keys.map((row) => row.kms_key_id)).size, 5);
    const uncertain = await invitations.select(taoAccount, {
      name: 'Recoverable TI',
      schemas: [type],
      accredited_until: new Date(Date.now() + 86400000).toISOString(),
    });
    organizations.push(uncertain.organization_id);
    kms.state.loseNextResponse = true;
    await invitations.register({
      invitation: uncertain.invitation,
      username: 'recovery.' + prefix,
      password,
      kind: 'ti',
    });
    assert.equal(kms.state.creates, 12);
    await onboarding.refresh(uncertain.organization_id);
    assert.equal(
      (
        await database.query('SELECT tir_attribute_id FROM accredited_organizations WHERE id=$1', [
          uncertain.organization_id,
        ])
      ).rows[0].tir_attribute_id,
      null,
    );
    await assert.rejects(onboarding.onboard(uncertain.organization_id), /tag-verified recovery/);
    assert.equal(kms.state.creates, 12);
    const intent = (
      await database.query(
        'SELECT request_id FROM organization_key_requests WHERE organization_id=$1',
        [uncertain.organization_id],
      )
    ).rows[0];
    const recoveryKey = [...kms.keys.keys()].at(-1)!;
    await database.query("INSERT INTO operator_roles VALUES($1,'plr_admin')", [actor]);
    await postgresKeyManagement(database, {
      kms: kmsKeyCeremony(kms.client),
      dids: didRegistry({ identifiersUrl: didRegistryUrl }),
    }).provision(actor, intent.request_id, recoveryKey);
    await onboarding.onboard(uncertain.organization_id);
    assert.equal(kms.state.creates, 16);
    assert.equal(
      (
        await database.query(
          'SELECT count(*)::int AS n FROM issuer_signing_keys WHERE organization_id=$1 AND active',
          [uncertain.organization_id],
        )
      ).rows[0].n,
      5,
    );
    await trust.ensureAccredited(issuer.did, type, {
      attribute: issuer.tir_attribute_id,
      schemaId: published.body.versions[0].schema_address,
    });
    const next = await management.propose(actor, {
      credential_type: type,
      name_sk: 'Oprávnenie',
      fields: [field, { ...field, key: 'validOn', kind: 'date', required: false }],
    });
    await trust.ensureAccredited(issuer.did, type, {
      attribute: issuer.tir_attribute_id,
      schemaId: next.versions[0].schema_address,
    });
    const schemaId = (
      await database.query('SELECT id FROM certificate_schemas WHERE credential_type=$1', [type])
    ).rows[0].id;
    // Not collected yet: the ledger holds no record of it.
    const certificate = randomUUID();
    await database.query(
      `INSERT INTO registered_certificates(id,credential_id,issuer_id,issuer_did,schema_id,schema_version,certificate_number,private_data,created_by)
    VALUES($1,$2,$3,$4,$5,1,'stage-two',$6,$7)`,
      [
        certificate,
        'urn:uuid:' + certificate,
        ti.organization_id,
        issuer.did,
        schemaId,
        Buffer.from('isolated-test-data'),
        issuer.account_id,
      ],
    );
    await invitations.setLifespan(taoAccount, {
      organization_id: ti.organization_id,
      end_now: true,
    });
    assert.equal(
      (
        await database.query('SELECT local_standing FROM registered_certificates WHERE id=$1', [
          certificate,
        ])
      ).rows[0].local_standing,
      'active',
    );
    await invitations.setLifespan(taoAccount, {
      organization_id: ti.organization_id,
      accredited_until: new Date(Date.now() + 2 * 86400000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', ''),
    });
    await invitations.setSchemas(taoAccount, { organization_id: ti.organization_id, schemas: [] });
    // History keeps both published versions covered after current delegation is removed.
    await trust.ensureAccredited(issuer.did, type, {
      attribute: issuer.tir_attribute_id,
      schemaId: published.body.versions[0].schema_address,
    });
    await management.retire(actor, { credential_type: type });
    assert.ok((await synchronizeSchemas(database, runtime.ebsi!.supportOffice!)) >= 2);
    const catalog = await postgresSchemaCatalog(database).names();
    assert.ok(catalog.find((item) => item.credential_type === type)?.labels.validOn);
    const revoked = await request('/registry/trust-chain/revoke/', {
      organization_id: tao.organization_id,
      reason: 'breach',
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.suspended, 1);
    assert.equal(revoked.body.revocations_proposed, 1);
    assert.equal(
      (
        await database.query('SELECT active FROM operator_accounts WHERE id=$1', [
          issuer.account_id,
        ])
      ).rows[0].active,
      false,
    );
    // The TAO's accreditation is withdrawn, which breaks the chain of every TI below it.
    const taoDid = (
      await database.query('SELECT did FROM accredited_organizations WHERE id=$1', [
        tao.organization_id,
      ])
    ).rows[0].did;
    assert.equal((await issuerAttributes(tirUrl, taoDid))[0].issuerType, 'Revoked');
    await assert.rejects(
      trust.ensureAccredited(issuer.did, type, {
        attribute: issuer.tir_attribute_id,
        schemaId: published.body.versions[0].schema_address,
      }),
    );
    const proposal = (
      await database.query('SELECT * FROM certificate_status_proposals WHERE certificate_id=$1', [
        certificate,
      ])
    ).rows[0];
    assert.equal(proposal.reason_code, 'issuer_revoked');
    assert.equal(proposal.decision, null);
    // The revoker cannot silently act as the independent status approver.
    await assert.rejects(
      postgresStatusProposals(database, { governanceEnabled: false }).decide(
        actor,
        proposal.id,
        'approved',
      ),
    );
  },
);
