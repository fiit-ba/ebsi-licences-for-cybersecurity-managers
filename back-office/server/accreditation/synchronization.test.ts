import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import { issuerAttributes } from './registry.ts';
import { kmsHttpFixture } from '../keys/fixtures/kms-http.ts';
import { postgresInvitations } from './invitations.ts';
import { trustedSchemaRegistry } from '../schemas/tsr.ts';
import { ebsiIssuerTrust } from '../issuance/ebsi-trust.ts';
import { testLedger } from '../lifecycle/fixtures/ledger.ts';
import { developmentWalletDid } from './development-wallet.ts';
import { testDid } from './fixtures/dids.ts';
import { developmentSupportOffice } from '../ebsi/support-office.ts';
import { registerDevelopmentSchemas } from '../schemas/publication.ts';
import { certificateSchemaDocument } from '../schemas/fixtures/certificate-schema.ts';
import { testEbsi } from '../ebsi/fixtures/environment.ts';

test(
  'development synchronization CLI reads the configured schemas, plays the demonstration wallets and keeps withdrawn TIs withdrawn, through HTTP KMS',
  { skip: !process.env.BACK_OFFICE_TEST_EBSI_URL },
  async (context) => {
    assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
    // The CLI synchronizes every organization in its database: a database of its own keeps
    // other scenarios' organizations, whose keys live in other KMS fixtures, out of it.
    const name = 'atest_sync_' + randomUUID().replaceAll('-', '');
    const control = new pg.Pool();
    await control.query('CREATE DATABASE ' + name);
    const kms = await kmsHttpFixture();
    const database = new pg.Pool({ database: name });
    context.after(async () => {
      try {
        await kms.close();
        await database.end();
        // The pool reports itself ended before its connections have closed. Dropping the
        // database then would terminate one still closing, an error no listener takes.
        for (let attempt = 0; attempt < 200; attempt++) {
          const {
            rows: [{ open }],
          } = await control.query(
            'SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname=$1',
            [name],
          );
          if (!open) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await control.query(`DROP DATABASE ${name} WITH (FORCE)`);
      } finally {
        await control.end();
      }
    });
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../data/migrate.ts', import.meta.url))],
      { env: { ...process.env, PGDATABASE: name }, stdio: 'pipe' },
    );
    const base = process.env.BACK_OFFICE_TEST_EBSI_URL!;
    const network = await testLedger();
    const tirUrl = testEbsi(base).PLR_TIR_URL;
    const schemas = trustedSchemaRegistry(testEbsi(base).PLR_TSR_URL);
    /**
     * A fresh issuer-trust reader, so no earlier answer is reused.
     * @returns EBSI trust-chain checks against the development registries.
     */
    const trust = () =>
      ebsiIssuerTrust({
        tirUrl,
        didRegistryUrl: testEbsi(base).PLR_DIDR_URL,
        trustedRoots: ['did:ebsi:zSupport'],
      });
    const suffix = randomUUID().replaceAll('-', '');
    const organizations: string[] = [];
    const accounts: number[] = [];
    for (let i = 0; i < 3; i++)
      accounts.push(
        (
          await database.query(
            'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
            [suffix + i, 'no-password'],
          )
        ).rows[0].id,
      );
    await database.query("INSERT INTO operator_roles VALUES($1,'plr_rtao')", [accounts[0]]);
    // The demonstration TAO and TI, whose wallets the CLI plays: the TAO's DID is the one the
    // governance contracts were deployed for, the TI's that of the second development wallet.
    const taoDid = testDid();
    const dids = ['', taoDid, developmentWalletDid(1)];
    for (const [index, kind] of ['rtao', 'tao', 'ti'].entries())
      organizations.push(
        (
          await database.query(
            'INSERT INTO accredited_organizations(name,kind,parent_id,account_id,did) VALUES($1,$2,$3,$4,$5) RETURNING id',
            [
              suffix + kind,
              kind,
              organizations.at(-1) ?? null,
              accounts[[0, 2, 1][index]],
              dids[index],
            ],
          )
        ).rows[0].id,
      );
    const schema = (
      await database.query(
        'INSERT INTO licence_schemas(credential_type,name_sk,retired_at) VALUES($1,$1,now()) RETURNING id',
        ['Sync' + suffix],
      )
    ).rows[0].id;
    const ids = ['zSync' + suffix + 'V1', 'zSync' + suffix + 'V2'];
    // EBSI's Support Office registered both versions; the CLI reads the ones it is configured with.
    const field = {
      key: 'number',
      kind: 'text',
      label: { sk: 'Číslo', en: 'Číslo' },
      hint: { sk: '', en: '' },
      required: true,
      default: '',
    };
    const supportOffice = developmentSupportOffice(base)!;
    await registerDevelopmentSchemas(
      supportOffice,
      ids.map((id) => ({
        id,
        document: certificateSchemaDocument('Sync' + suffix, 'Sync', [field]),
      })),
    );
    for (const [index, id] of ids.entries())
      await database.query(
        "INSERT INTO licence_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,$2,'[]',$3,now())",
        [schema, index + 1, id],
      );
    await database.query('INSERT INTO organization_licence_schemas VALUES($1,$2)', [
      organizations[2],
      schema,
    ]);
    /**
     * Invoke the actual TypeScript CLI with only loopback registry and KMS services.
     * @returns Parsed aggregate synchronization result.
     * @throws AssertionError if the CLI exits unsuccessfully or returns malformed output.
     */
    async function synchronize() {
      const child = spawn(process.execPath, ['scripts/sync-development-registry.ts'], {
        env: {
          ...process.env,
          PGDATABASE: name,
          // EBSI's Core API v1 as production uses it; the Support Office's own acts through
          // /__mock. No governance contract: the TAO here is not the one it was deployed for.
          PLR_EBSI_MOCK_URL: base,
          PLR_EBSI_URL: base,
          PLR_EBSI_API: testEbsi(base).PLR_EBSI_API,
          PLR_TIR_URL: tirUrl,
          PLR_TSR_URL: testEbsi(base).PLR_TSR_URL,
          PLR_LEDGER_RPC_URL: testEbsi(base).PLR_LEDGER_RPC_URL,
          PLR_LEDGER_CHAIN_ID: String(network.chainId),
          PLR_GOVERNANCE_CONTRACT: '',
          PLR_CERTIFICATE_REGISTRY: '',
          PLR_GOVERNANCE_TAO_DID: taoDid,
          PLR_TSR_SCHEMAS: ids.join(','),
          AWS_REGION: 'eu-central-1',
          AWS_ACCESS_KEY_ID: 'fixture-only',
          AWS_SECRET_ACCESS_KEY: 'fixture-only',
          AWS_SESSION_TOKEN: '',
          PLR_KMS_ENDPOINT_URL: kms.origin,
        },
      });
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk) => (output += String(chunk)));
      child.stderr.on('data', (chunk) => (errors += String(chunk)));
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 0, errors);
      return JSON.parse(output.trim());
    }
    // The RootTAO and TAO get three keys each on their way to the TI, which gets five.
    assert.equal((await synchronize()).issuers, 1);
    assert.equal(kms.state.creates, 11);
    for (const id of ids)
      assert.equal((await schemas.document(schemas.address(id))).type, 'object');
    assert.equal((await synchronize()).issuers, 1);
    assert.equal(kms.state.creates, 11);
    const [tao, issuer] = (
      await database.query(
        'SELECT did,tir_attribute_id FROM accredited_organizations WHERE id=ANY($1::uuid[]) ORDER BY kind',
        [organizations.slice(1)],
      )
    ).rows;
    const accredited = { attribute: issuer.tir_attribute_id, schemaId: schemas.address(ids[0]) };
    await trust().ensureAccredited(issuer.did, 'Sync' + suffix, accredited);
    await postgresInvitations(database, { governanceEnabled: false }).revoke(accounts[0], {
      organization_id: organizations[1],
      reason: 'breach',
    });
    assert.equal((await synchronize()).issuers, 0);
    // The revoked TAO's accreditation is withdrawn, which breaks the chain of its TI.
    assert.equal((await issuerAttributes(tirUrl, tao.did))[0].issuerType, 'Revoked');
    await assert.rejects(trust().ensureAccredited(issuer.did, 'Sync' + suffix, accredited));
    assert.equal(kms.state.creates, 11);
  },
);
