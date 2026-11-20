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
import { developmentWallet } from './development-wallet.ts';
import { postgresAccreditation } from './revalidation.ts';
import { kmsHttpFixture } from '../keys/fixtures/kms-http.ts';
import { kmsKeyCeremony } from '../keys/kms-provider.ts';
import { postgresKeyManagement } from '../keys/management.ts';
import { didRegistry } from '../ebsi/did-registry.ts';
import { trustedSchemaRegistry } from '../schemas/tsr.ts';
import { registrySchemas } from '../schemas/registry-schemas.ts';
import { certificateSchemaDocument } from '../schemas/fixtures/certificate-schema.ts';
import type { SchemaField } from '../schemas/types.ts';
import { registerDevelopmentSchemas } from '../schemas/publication.ts';
import { configuredOrganizations, trustChainSchemas } from './runtime.ts';
import { postgresSchemaCatalog } from '../schemas/catalog.ts';
import { postgresIssuanceSchemes } from '../issuance/schemes.ts';
import { ebsiIssuerTrust } from '../issuance/ebsi-trust.ts';
import { postgresStatusProposals } from '../lifecycle/proposals.ts';
import { testLedger } from '../lifecycle/fixtures/ledger.ts';
import { testEbsi } from '../ebsi/fixtures/environment.ts';

test(
  'real development DID/TIR/TSR: publication, TI keys, delegated versions, expiry and branch revocation',
  { skip: !process.env.BACK_OFFICE_TEST_EBSI_URL },
  async (context) => {
    assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
    const database = new pg.Pool();
    const base = process.env.BACK_OFFICE_TEST_EBSI_URL!;
    const network = await testLedger();
    const tirUrl = testEbsi(base).PLR_TIR_URL;
    const didRegistryUrl = testEbsi(base).PLR_DIDR_URL;
    const schemas = trustedSchemaRegistry(testEbsi(base).PLR_TSR_URL);
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
      PLR_EBSI_API: testEbsi(base).PLR_EBSI_API,
      PLR_TIR_URL: tirUrl,
      PLR_DIDR_URL: didRegistryUrl,
      PLR_TRUSTED_ROOT_DIDS: 'did:ebsi:zSupport',
      PLR_LEDGER_RPC_URL: testEbsi(base).PLR_LEDGER_RPC_URL,
      PLR_LEDGER_CHAIN_ID: String(network.chainId),
      AWS_REGION: 'eu-central-1',
      PLR_KMS_ENDPOINT_URL: kms.origin,
    });
    // Keys are created in process, so a lost response is not retried by the SDK.
    const publication = {
      ebsi: runtime.ebsi!,
      tirUrl,
      trustChainSchemas: trustChainSchemas(schemas),
    };
    const onboarding = postgresOrganizationOnboarding(database, {
      keys: kmsKeyCeremony(kms.client),
      publication,
      schemaAddress: schemas.address,
    });
    const accreditation = postgresAccreditation(database, {
      issuerDid: registryDid,
      tirUrl,
      schemaAddress: schemas.address,
      check: trust.ensureAccredited,
    });
    const invitations = postgresInvitations(database, {
      didRegistered: runtime.invitationOptions.didRegistered,
      check: onboarding.check,
      onboard: onboarding.onboard,
      refresh: onboarding.refresh,
      withdraw: runtime.withdrawals.deliver,
      governanceEnabled: false,
    });
    const accounts: number[] = [];
    const organizations: string[] = [];
    // Schemas of other checks a synchronization here retired; put back afterwards.
    const retiredByUs = new Set<string>();
    const password = 'Q7!Vx2#Bm9@Kp4$Zs8%Fj6&Wy3';
    const initialGroups = (await database.query('SELECT id FROM operator_groups')).rows.map(
      (row) => row.id,
    );
    const tokens = operatorTokens('registry-live-' + prefix + '-'.repeat(32));
    const server = backOfficeServer({
      accounts: postgresAccounts(database),
      tokens,
      invitations,
      registrySchemas: registrySchemas(database, schemas, { ids: [] }),
      schemaCatalog: postgresSchemaCatalog(database),
      issuanceSchemes: postgresIssuanceSchemes(database),
      accreditation,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    context.after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.query(
        'UPDATE licence_schemas SET retired_at = NULL WHERE credential_type = ANY($1::text[])',
        [[...retiredByUs].filter((retired) => retired !== type)],
      );
      const members = (
        await database.query(
          'SELECT account_id FROM accredited_organizations WHERE id=ANY($1::uuid[])',
          [organizations],
        )
      ).rows
        .map((row) => row.account_id)
        .filter(Boolean);
      for (const table of ['licence_status_proposals', 'licence_emergency_suspensions'])
        await database.query(
          `DELETE FROM ${table} WHERE licence_id IN (SELECT id FROM registered_licences WHERE issuer_id=ANY($1::uuid[]))`,
          [organizations],
        );
      await database.query('DELETE FROM registered_licences WHERE issuer_id=ANY($1::uuid[])', [
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
        'DELETE FROM licence_schema_versions WHERE schema_id IN(SELECT id FROM licence_schemas WHERE credential_type=$1)',
        [type],
      );
      await database.query('DELETE FROM licence_schemas WHERE credential_type=$1', [type]);
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
    const field: SchemaField = {
      key: 'number',
      kind: 'text',
      label: { sk: 'Číslo', en: 'Číslo' },
      hint: { sk: '', en: '' },
      required: true,
      default: '',
    };
    // The Support Office registers the schema; the back-office reads the configured ids back.
    const publish = async (ids: string[], documents: [string, SchemaField[]][]) => {
      await registerDevelopmentSchemas(
        runtime.ebsi!.supportOffice!,
        documents.map(([id, fields]) => ({
          id,
          document: certificateSchemaDocument(type, 'Oprávnenie', fields),
        })),
      );
      const { retired } = await registrySchemas(database, schemas, {
        ids,
        registered: runtime.schemaOptions.registered,
      }).synchronize();
      for (const schema of retired) retiredByUs.add(schema);
      return (await registrySchemas(database, schemas, { ids }).list()).schemas.find(
        (schema) => schema.credential_type === type,
      )!;
    };
    const first = 'zStageTwo' + prefix + 'V1';
    const second = 'zStageTwo' + prefix + 'V2';
    const published = await publish([first], [[first, [field]]]);
    assert.equal(published.current_version, 1);
    assert.equal(
      (await schemas.document(published.versions[0].schema_address)).properties.credentialSubject
        .required[0],
      'id',
    );
    // The TAO and the TIs bring their own DIDs, registered with their own wallets: here
    // development ones, which also list the back-office's keys and store their accreditations.
    const walletBase = Math.floor(Math.random() * 2 ** 29);
    const taoWallet = developmentWallet(database, publication, walletBase);
    await onboarding.ensureAuthority(organizations[0]);
    await taoWallet.register(organizations[0]);
    const refused = async (input: Record<string, unknown>, reason: string, by = actor) =>
      assert.rejects(
        invitations.select(by, input),
        (error) => (error as any).body.reason === reason,
      );
    await refused({ name: 'No DID', schemas: [type] }, 'InvalidFields');
    await refused(
      { name: 'Unknown', did: developmentWallet(database, publication, walletBase + 9).did },
      'DidNotRegistered',
    );
    const tao = await invitations.select(actor, {
      name: 'Live registry TAO',
      schemas: [type],
      did: taoWallet.did,
    });
    assert.equal(tao.did, taoWallet.did);
    organizations.push(tao.organization_id);
    await refused({ name: 'Same DID', did: taoWallet.did }, 'DidTaken');
    await invitations.register({ invitation: tao.invitation, username: 'tao.' + prefix, password });
    const taoAccount = (
      await database.query('SELECT account_id FROM accredited_organizations WHERE id=$1', [
        tao.organization_id,
      ])
    ).rows[0].account_id;
    // Registering issued its accreditation; it is accredited once it stores it with its wallet
    // and lists the back-office's keys, never before.
    let state = await invitations.ebsi(taoAccount, {});
    assert.equal(state.accredited, false);
    assert.equal(state.did, taoWallet.did);
    assert.match(state.accreditation!, /^ey/);
    assert.ok(state.keys.length === 3 && state.keys.every((key) => !key.listed));
    await taoWallet.complete(tao.organization_id);
    state = await invitations.ebsi(actor, { organization_id: tao.organization_id });
    assert.equal(state.accredited, true);
    assert.ok(state.keys.every((key) => key.listed));
    await assert.rejects(
      postgresInvitations(database, {
        maxAccreditationDays: 1,
        didRegistered: async () => true,
      }).select(taoAccount, {
        name: 'Too long',
        did: developmentWallet(database, publication, walletBase + 8).did,
        accredited_until: new Date(Date.now() + 2 * 86400000).toISOString(),
      }),
      (error) =>
        (error as any).body.reason === 'LifespanTooLong' && (error as any).body.codes[0] === '1',
    );
    const tiWallet = developmentWallet(database, publication, walletBase + 1);
    await tiWallet.register(tao.organization_id);
    const ti = await invitations.select(taoAccount, {
      name: 'Live registry TI',
      schemas: [type],
      did: tiWallet.did,
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
    assert.equal(issuer.did, tiWallet.did);
    assert.ok(issuer.accreditation_credential, 'registration issues the accreditation at once');
    assert.equal(issuer.tir_attribute_id, null);
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
    await tiWallet.complete(ti.organization_id);
    // Only the organization or the one that appointed it checks it.
    const tiCheck = '/registry/trust-chain/ebsi/';
    assert.equal(
      (await request(tiCheck, { organization_id: ti.organization_id })).body.reason,
      'NotYours',
    );
    const taoToken = (await tokens.pair({ id: taoAccount, username: 'tao.' + prefix })).access;
    const checked = await request(tiCheck, { organization_id: ti.organization_id }, taoToken);
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.equal(checked.body.accredited, true);
    issuer = (
      await database.query('SELECT * FROM accredited_organizations WHERE id=$1', [
        ti.organization_id,
      ])
    ).rows[0];
    assert.match(issuer.tir_attribute_id, /^0x[0-9a-f]{64}$/);
    const uncertainWallet = developmentWallet(database, publication, walletBase + 2);
    await uncertainWallet.register(tao.organization_id);
    const uncertain = await invitations.select(taoAccount, {
      name: 'Recoverable TI',
      did: uncertainWallet.did,
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
      schemaId: published.versions[0].schema_address,
    });
    const next = await publish(
      [first, second],
      [[second, [field, { ...field, key: 'validOn', kind: 'date', required: false }]]],
    );
    // Their accreditations were issued again to cover it; each stores its new one itself.
    await taoWallet.complete(tao.organization_id);
    await tiWallet.complete(ti.organization_id);
    await trust.ensureAccredited(issuer.did, type, {
      attribute: issuer.tir_attribute_id,
      schemaId: next.versions[0].schema_address,
    });
    const schemaId = (
      await database.query('SELECT id FROM licence_schemas WHERE credential_type=$1', [type])
    ).rows[0].id;
    // Not collected yet: the ledger holds no record of it.
    const certificate = randomUUID();
    await database.query(
      `INSERT INTO registered_licences(id,credential_id,issuer_id,issuer_did,schema_id,schema_version,licence_number,private_data,created_by)
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
        await database.query('SELECT local_standing FROM registered_licences WHERE id=$1', [
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
      schemaId: published.versions[0].schema_address,
    });
    // No id of the type configured any more: retired, its labels still known.
    assert.ok((await publish([], [])).retired_at);
    const catalog = await postgresSchemaCatalog(database).names();
    assert.ok(catalog.find((item) => item.credential_type === type)?.labels.validOn);
    // A TI revoked before it stored the accreditation it was issued: its reserved attribute is
    // revoked, so it cannot store that accreditation afterwards.
    const withdrawn = await request(
      '/registry/trust-chain/revoke/',
      { organization_id: uncertain.organization_id, reason: 'breach' },
      taoToken,
    );
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    await runtime.withdrawals.deliver();
    assert.equal((await issuerAttributes(tirUrl, uncertainWallet.did))[0]?.issuerType, 'Revoked');
    await assert.rejects(uncertainWallet.complete(uncertain.organization_id));
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
        schemaId: published.versions[0].schema_address,
      }),
    );
    const proposal = (
      await database.query('SELECT * FROM licence_status_proposals WHERE licence_id=$1', [
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
