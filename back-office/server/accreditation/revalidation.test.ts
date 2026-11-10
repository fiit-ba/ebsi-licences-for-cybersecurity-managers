import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { postgresAccreditation } from './revalidation.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { backOfficeServer } from '../http/app.ts';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('accreditation caches isolate issuers/types, bound outage grace and retain the confirmed schema binding', async (context) => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const suffix = randomUUID().replaceAll('-', '');
  const type = 'Revalidation' + suffix;
  const did = 'did:ebsi:z' + suffix;
  const other = did + 'Other';
  const schema = (
    await database.query(
      'INSERT INTO certificate_schemas(credential_type,name_sk) VALUES($1,$1) RETURNING id',
      [type],
    )
  ).rows[0].id;
  context.after(async () => {
    try {
      await database.query(
        'DELETE FROM issuer_accreditation_checks WHERE issuer_did=ANY($1::text[])',
        [[did, other]],
      );
      await database.query('DELETE FROM certificate_schema_versions WHERE schema_id=$1', [schema]);
      await database.query('DELETE FROM certificate_schemas WHERE id=$1', [schema]);
    } finally {
      await database.end();
    }
  });
  await database.query(
    "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,1,'[]','version1',now())",
    [schema],
  );
  let mode = 'trusted';
  let checks = 0;
  const service = postgresAccreditation(database, {
    issuerDid: did,
    tirUrl: 'https://tir.example/v5',
    schemaAddress: (id) => 'https://tsr.example/' + id,
    fetchRegistry: async (input) =>
      String(input).endsWith('/attributes')
        ? Response.json({ items: [{ id: 'attribute' }], links: {} })
        : Response.json({
            did: String(input).includes(encodeURIComponent(other)) ? other : did,
            attribute: { issuerType: 'TI' },
          }),
    check: async () => {
      checks++;
      if (mode !== 'trusted')
        throw new IssuanceError(
          mode === 'outage' ? 503 : 409,
          mode === 'outage' ? 'AccreditationUnavailable' : 'NotAccredited',
          mode,
        );
    },
  });
  const initial = await service.state(true, type);
  assert.equal(initial.accredited, true);
  await service.ensureAccredited(did, type, { schemaId: initial.schema_id });
  assert.equal(checks, 1);
  mode = 'outage';
  assert.equal((await service.state(true, type)).confirmed_at, initial.confirmed_at);
  await service.ensureAccredited(did, type, { schemaId: initial.schema_id });
  await assert.rejects(
    service.ensureAccredited(other, type, {}),
    (error) => error instanceof IssuanceError && error.body.reason === 'NotAccredited',
  );
  await assert.rejects(service.ensureAccredited(did, type + 'Other', {}));
  await database.query(
    "INSERT INTO certificate_schema_versions(schema_id,version,fields,tsr_id,registered_at) VALUES($1,2,'[]','version2',now())",
    [schema],
  );
  const unavailable = await service.state(true, type);
  assert.equal(unavailable.schema_id, initial.schema_id);
  await assert.rejects(
    service.ensureAccredited(did, type, { schemaId: 'https://tsr.example/version2' }),
    (error) => error instanceof IssuanceError && error.body.reason === 'AccreditationUnavailable',
  );
  await database.query(
    `UPDATE issuer_accreditation_checks SET result=jsonb_set(result,'{confirmed_at}',to_jsonb((now()-interval '73 hours')::text)) WHERE issuer_did=$1`,
    [did],
  );
  await assert.rejects(service.ensureAccredited(did, type, {}));
  mode = 'untrusted';
  const refused = await service.state(true, type);
  assert.equal(refused.accredited, false);
  assert.equal(refused.confirmed_at, null);
  await assert.rejects(service.ensureAccredited(did, type, {}));
  mode = 'trusted';
  assert.equal((await service.state(true, type)).accredited, true);
  assert.equal((await service.state(false, type)).unavailable, undefined);
  await context.test(
    'the existing accreditation endpoint requires authentication and restricts forced refresh to issuer/auditor roles',
    async () => {
      const tokens = operatorTokens('accreditation-api-' + suffix + '-'.repeat(32));
      const accounts: number[] = [];
      const server = backOfficeServer({
        accounts: postgresAccounts(database),
        tokens,
        accreditation: service,
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        assert.equal((await fetch(origin + '/registry/accreditation/')).status, 401);
        await service.state(true);
        let expected = checks;
        for (const role of ['plr_rtao', 'plr_issuer', 'plr_auditor', '']) {
          const account = (
            await database.query(
              'INSERT INTO operator_accounts(username,password_hash) VALUES($1,$2) RETURNING id',
              [suffix + role, 'no-password'],
            )
          ).rows[0].id;
          accounts.push(account);
          if (role)
            await database.query('INSERT INTO operator_roles VALUES($1,$2)', [account, role]);
          const token = (await tokens.pair({ id: account, username: suffix + role })).access;
          const response = await fetch(origin + '/registry/accreditation/?refresh=1', {
            headers: { authorization: 'Bearer ' + token },
          });
          assert.equal(response.status, 200);
          assert.equal((await response.json()).issuer_did, did);
          if (['plr_issuer', 'plr_auditor'].includes(role)) expected++;
          assert.equal(checks, expected);
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::integer[])', [
          accounts,
        ]);
      }
    },
  );
});
