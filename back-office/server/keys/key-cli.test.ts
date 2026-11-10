import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import pg from 'pg';
import {
  CreateKeyCommand,
  DescribeKeyCommand,
  GetPublicKeyCommand,
  ListResourceTagsCommand,
} from '@aws-sdk/client-kms';
import { kmsCeremonyFixture } from './fixtures/kms-ceremony.ts';

const execute = promisify(execFile);

test('key CLI uses actual SDK serialization, one-attempt creation and durable tagged recovery', async () => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const organization = randomUUID();
  const did = 'did:ebsi:zRunRoot';
  const fixture = kmsCeremonyFixture();
  let expose = false;
  let loseCreate = false;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        const keys = [...fixture.keys.values()];
        const methods = [];
        for (const key of keys) {
          const publicKey = key.publicKey.export({ format: 'jwk' });
          const { calculateJwkThumbprint } = await import('jose');
          const kid = did + '#' + (await calculateJwkThumbprint(publicKey));
          methods.push({
            id: kid,
            controller: did,
            type: 'JsonWebKey2020',
            publicKeyJwk: publicKey,
          });
        }
        response.setHeader('content-type', 'application/did+json');
        response.end(
          JSON.stringify({
            id: did,
            verificationMethod: expose ? methods : [],
            assertionMethod: expose ? methods.map((method) => method.id) : [],
          }),
        );
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const method = String(request.headers['x-amz-target']).split('.').at(-1);
      let result;
      if (method === 'CreateKey') {
        result = await fixture.client.send(new CreateKeyCommand(input));
        if (loseCreate) {
          loseCreate = false;
          response.writeHead(503, { 'content-type': 'application/x-amz-json-1.1' });
          response.end(
            JSON.stringify({
              __type: 'KMSInternalException',
              message: 'Synthetic uncertain creation.',
            }),
          );
          return;
        }
      } else if (method === 'GetPublicKey') {
        const key = await fixture.client.send(new GetPublicKeyCommand(input));
        result = { ...key, PublicKey: Buffer.from(key.PublicKey!).toString('base64') };
      } else if (method === 'DescribeKey')
        result = await fixture.client.send(new DescribeKeyCommand(input));
      else if (method === 'ListResourceTags')
        result = await fixture.client.send(new ListResourceTagsCommand(input));
      else throw new Error('Unexpected SDK action.');
      response.writeHead(200, { 'content-type': 'application/x-amz-json-1.1' });
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(500, { 'content-type': 'application/x-amz-json-1.1' });
      response.end(
        JSON.stringify({ __type: 'KMSInternalException', message: 'Fixture request failed.' }),
      );
    }
  });
  let actor: number | undefined;
  try {
    actor = (
      await database.query<{ id: number }>(
        'INSERT INTO operator_accounts (username,password_hash) VALUES ($1,$2) RETURNING id',
        ['cli-' + randomUUID(), 'unused-test-password-hash'],
      )
    ).rows[0].id;
    await database.query("INSERT INTO operator_roles VALUES ($1,'plr_admin'),($1,'plr_rtao')", [
      actor,
    ]);
    await database.query(
      "INSERT INTO accredited_organizations (id,name,kind,account_id) VALUES ($1,'CLI root','rtao',$2)",
      [organization, actor],
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const script = fileURLToPath(new URL('../../scripts/signing-keys.ts', import.meta.url));
    const env: Record<string, string> = {
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'test-only',
      AWS_SECRET_ACCESS_KEY: 'test-only',
      AWS_SESSION_TOKEN: 'test-only',
      AWS_EC2_METADATA_DISABLED: 'true',
      PLR_KMS_ENDPOINT_URL: origin,
      PLR_DIDR_URL: origin + '/identifiers',
    };
    for (const setting of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'])
      if (process.env[setting] !== undefined) env[setting] = process.env[setting]!;
    const run = async (action: string, ...args: string[]) => {
      const result = await execute(
        process.execPath,
        [script, action, '--actor', String(actor), ...args],
        { env, timeout: 20_000, maxBuffer: 100_000 },
      );
      return JSON.parse(result.stdout);
    };
    await run('identity', '--organization', organization, '--did', did);
    const id = randomUUID();
    assert.equal(
      (
        await run(
          'plan',
          '--organization',
          organization,
          '--purpose',
          'credential_signing',
          '--request-id',
          id.toUpperCase(),
        )
      ).request_id,
      id,
    );
    loseCreate = true;
    await assert.rejects(run('provision', '--request-id', id), (error) =>
      String((error as { stderr?: unknown }).stderr).includes('Synthetic uncertain creation'),
    );
    assert.equal(fixture.state.creates, 1, 'SDK retry middleware must not repeat CreateKey.');
    await assert.rejects(run('provision', '--request-id', id), (error) =>
      String((error as { stderr?: unknown }).stderr).includes('Recover its tagged KMS key'),
    );
    assert.equal(fixture.state.creates, 1);
    const arn = [...fixture.keys.keys()][0];
    const prepared = await run('provision', '--request-id', id, '--recover-key', arn);
    assert.equal(prepared.state, 'pending');
    assert.equal(JSON.stringify(prepared).includes('arn:'), false);
    await assert.rejects(
      run(
        'activate',
        '--organization',
        organization,
        '--key',
        prepared.key_id,
        '--expected-active',
        'none',
      ),
    );
    expose = true;
    assert.equal(
      (
        await run(
          'activate',
          '--organization',
          organization,
          '--key',
          prepared.key_id,
          '--expected-active',
          'none',
        )
      ).state,
      'active',
    );
    assert.equal((await run('list', '--organization', organization))[0].key_id, prepared.key_id);
    assert.equal(
      (await run('retire', '--organization', organization, '--key', prepared.key_id)).state,
      'retired',
    );
    assert.equal(fixture.state.creates, 1);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await database.query('DELETE FROM signing_key_provisions WHERE organization_id=$1', [
      organization,
    ]);
    await database.query('DELETE FROM issuer_signing_keys WHERE organization_id=$1', [
      organization,
    ]);
    await database.query('DELETE FROM accredited_organizations WHERE id=$1', [organization]);
    if (actor) await database.query('DELETE FROM operator_accounts WHERE id=$1', [actor]);
    await database.end();
  }
});
