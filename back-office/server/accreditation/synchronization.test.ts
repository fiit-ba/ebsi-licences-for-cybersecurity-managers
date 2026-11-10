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

test(
  'development synchronization CLI restores retired schema history and live issuers through HTTP KMS without reviving withdrawn TIs',
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
    const tirUrl = base + '/v1/issuers-registry';
    const schemas = trustedSchemaRegistry(base + '/v1/schemas-registry');
    /**
     * A fresh issuer-trust reader, so no earlier answer is reused.
     * @returns EBSI trust-chain checks against the development registries.
     */
    const trust = () =>
      ebsiIssuerTrust({
        tirUrl,
        didRegistryUrl: base + '/v1/did-registry/identifiers',
        trustedRoots: ['did:ebsi:zSupport'],
      });
    const suffix = randomUUID().replaceAll('-', '');
    const organizations: string[] = [];
    const accounts: number[] = [];
    for (let i = 0; i < 2; i++)
      accounts.push(
        (
          await database.query(
            'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
            [suffix + i, 'no-password'],
          )
        ).rows[0].id,
      );
    await database.query("INSERT INTO operator_roles VALUES($1,'plr_rtao')", [accounts[0]]);
    for (const [index, kind] of ['rtao', 'tao', 'ti'].entries())
      organizations.push(
        (
          await database.query(
            'INSERT INTO accredited_organizations(name,kind,parent_id,account_id) VALUES($1,$2,$3,$4) RETURNING id',
            [
              suffix + kind,
              kind,
              organizations.at(-1) ?? null,
              index === 0 ? accounts[0] : index === 2 ? accounts[1] : null,
            ],
          )
        ).rows[0].id,
      );
    const schema = (
      await database.query(
        'INSERT INTO certificate_schemas(credential_type,name_sk,retired_at) VALUES($1,$1,now()) RETURNING id',
        ['Sync' + suffix],
      )
    ).rows[0].id;
    const ids = ['zSync' + suffix + 'V1', 'zSync' + suffix + 'V2'];
    for (const [index, id] of ids.entries())
      await database.query(
        "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,$2,'[]',$3,now())",
        [schema, index + 1, id],
      );
    await database.query('INSERT INTO organization_certificate_schemas VALUES($1,$2)', [
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
          PLR_TIR_URL: tirUrl,
          PLR_TSR_URL: base + '/v1/schemas-registry',
          PLR_LEDGER_RPC_URL: base + '/v1/ledger',
          PLR_LEDGER_CHAIN_ID: String(network.chainId),
          PLR_GOVERNANCE_CONTRACT: '',
          PLR_CERTIFICATE_REGISTRY: '',
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
