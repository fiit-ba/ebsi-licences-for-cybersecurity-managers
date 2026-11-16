import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { kmsKeyCeremony } from './kms-provider.ts';
import { postgresKeyManagement } from './management.ts';
import { didRegistry } from '../ebsi/did-registry.ts';
import { postgresKmsIssuerSigning } from '../issuance/kms-signing.ts';
import { kmsCeremonyFixture } from './fixtures/kms-ceremony.ts';

test('key ceremonies separate material, persist uncertain creation and rotate only published methods', async () => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const organizations = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const accounts: number[] = [];
  const schemaIds = [randomUUID(), randomUUID()];
  const prefix = 'key-' + randomUUID();
  const did = 'did:ebsi:zKey' + randomUUID().replace(/[-0]/g, '');
  const rootDid = 'did:ebsi:zRootKey' + randomUUID().replace(/[-0]/g, '');
  try {
    for (const [index, role] of ['plr_admin', 'plr_rtao', 'plr_tao', 'plr_issuer'].entries()) {
      const id = (
        await database.query<{ id: number }>(
          'INSERT INTO operator_accounts (username,password_hash) VALUES ($1,$2) RETURNING id',
          [prefix + index, 'unused-test-hash'],
        )
      ).rows[0].id;
      accounts.push(id);
      await database.query('INSERT INTO operator_roles VALUES ($1,$2)', [id, role]);
    }
    await database.query(
      "INSERT INTO accredited_organizations (id,name,kind,account_id,did) VALUES ($1,'Key root','rtao',$2,$3)",
      [organizations[0], accounts[1], rootDid],
    );
    await database.query(
      "INSERT INTO accredited_organizations (id,name,kind,parent_id,account_id) VALUES ($1,'Key TAO','tao',$2,$3)",
      [organizations[1], organizations[0], accounts[2]],
    );
    await database.query(
      "INSERT INTO accredited_organizations (id,name,kind,parent_id,account_id) VALUES ($1,'Key TI','ti',$2,$3)",
      [organizations[2], organizations[1], accounts[3]],
    );
    const other = (
      await database.query<{ id: number }>(
        'INSERT INTO operator_accounts (username,password_hash) VALUES ($1,$2) RETURNING id',
        [prefix + '-other', 'unused-test-hash'],
      )
    ).rows[0].id;
    accounts.push(other);
    await database.query(
      "INSERT INTO accredited_organizations (id,name,kind,parent_id,account_id,did) VALUES ($1,'Other key TI','ti',$2,$3,'did:ebsi:zAnotherKey')",
      [organizations[3], organizations[1], other],
    );
    const fixture = kmsCeremonyFixture();
    const provider = kmsKeyCeremony(fixture.client);
    const published = new Map<
      string,
      { id: string; type: string; controller: string; publicKeyJwk: unknown }
    >();
    const relationships = {
      assertionMethod: [] as string[],
      authentication: [] as string[],
      capabilityInvocation: [] as string[],
    };
    const dids = didRegistry({
      identifiersUrl: 'https://keys.example/identifiers',
      fetchRegistry: async (input) => {
        const subject = new URL(String(input)).pathname.split('/').at(-1);
        return Response.json({
          id: subject,
          verificationMethod: [...published.values()],
          ...relationships,
        });
      },
    });
    const store = postgresKeyManagement(database, { kms: provider, dids });
    await assert.rejects(store.identity(accounts[3], organizations[2], did), {
      body: { reason: 'AdministratorRequired', detail: 'An active administrator is required.' },
    });
    await store.identity(accounts[0], organizations[2].toUpperCase(), did);
    await store.identity(accounts[0], organizations[2], did);
    await assert.rejects(store.identity(accounts[0], organizations[2], rootDid), {
      reason: 'IdentityImmutable',
    });
    await assert.rejects(store.identity(accounts[0], organizations[3], did), {
      reason: 'IdentityImmutable',
    });
    const request = randomUUID();
    await store.plan(accounts[0], organizations[2], 'credential_signing', request.toUpperCase());
    await store.plan(accounts[0], organizations[2], 'credential_signing', request);
    await assert.rejects(store.plan(accounts[0], organizations[2], 'did_authentication', request), {
      reason: 'RequestConflict',
    });
    const first = await store.provision(accounts[0], request);
    assert.equal(first.state, 'pending');
    assert.equal((await store.provision(accounts[0], request)).key_id, first.key_id);
    assert.equal(fixture.state.creates, 1);
    assert.equal(JSON.stringify(first).includes('arn:'), false);
    await assert.rejects(
      store.activate(accounts[0], organizations[2], first.key_id, null),
      /relationship/,
    );
    published.set(first.key_id, {
      id: first.key_id,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: first.public_jwk,
    });
    relationships.assertionMethod.push(first.key_id);
    assert.equal(
      (await store.activate(accounts[0], organizations[2], first.key_id, null)).state,
      'active',
    );
    assert.equal(
      (await store.activate(accounts[0], organizations[2], first.key_id, null)).state,
      'active',
    );
    const originalArn = [...fixture.keys.keys()][0];
    await assert.rejects(
      store.attach(accounts[0], organizations[2], 'did_authentication', originalArn),
      { reason: 'KeyAlreadyAssigned' },
    );
    await assert.rejects(
      store.attach(accounts[0], organizations[3], 'credential_signing', originalArn),
      { reason: 'KeyAlreadyAssigned' },
    );
    await assert.rejects(
      store.plan(accounts[0], organizations[2], 'timestamp_transactions', randomUUID()),
      { reason: 'TimestampOwner' },
    );
    for (const purpose of ['ledger_transactions', 'timestamp_transactions']) {
      const rootRequest = randomUUID();
      await store.plan(accounts[0], organizations[0], purpose, rootRequest);
      const rootKey = await store.provision(accounts[0], rootRequest);
      assert.equal(rootKey.curve, 'secp256k1');
      published.set(rootKey.key_id, {
        id: rootKey.key_id,
        type: 'JsonWebKey2020',
        controller: rootDid,
        publicKeyJwk: rootKey.public_jwk,
      });
      relationships.capabilityInvocation.push(rootKey.key_id);
      assert.equal(
        (await store.activate(accounts[0], organizations[0], rootKey.key_id, null)).state,
        'active',
      );
    }
    const next = [];
    for (let index = 0; index < 2; index++) {
      const nextRequest = randomUUID();
      await store.plan(accounts[0], organizations[2], 'credential_signing', nextRequest);
      const candidate = await store.provision(accounts[0], nextRequest);
      published.set(candidate.key_id, {
        id: candidate.key_id,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk: candidate.public_jwk,
      });
      relationships.assertionMethod.push(candidate.key_id);
      next.push(candidate);
    }
    const race = await Promise.allSettled(
      next.map((candidate) =>
        store.activate(accounts[0], organizations[2], candidate.key_id, first.key_id),
      ),
    );
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      (race.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.reason,
      'ActiveKeyChanged',
    );
    const history = await store.list(accounts[0], organizations[2]);
    const retired = history.find((key) => key.key_id === first.key_id)!;
    const active = history.find((key) => key.state === 'active')!;
    assert.equal(retired.state, 'retired');
    assert.equal(+retired.retired_at!, +active.activated_at!);
    await assert.rejects(
      store.activate(accounts[0], organizations[2], first.key_id, active.key_id),
      { reason: 'KeyRetired' },
    );

    const uncertain = randomUUID();
    await store.plan(accounts[0], organizations[2], 'did_authentication', uncertain);
    fixture.state.loseNextResponse = true;
    await assert.rejects(store.provision(accounts[0], uncertain), /response lost/);
    const creations = fixture.state.creates;
    await assert.rejects(store.provision(accounts[0], uncertain), {
      reason: 'KeyCreationUncertain',
    });
    assert.equal(fixture.state.creates, creations);
    await assert.rejects(store.provision(accounts[0], uncertain, originalArn), /does not belong/);
    const lost = [...fixture.keys.values()].find((key) =>
      key.tags.some((tag) => tag.TagKey === 'atest-request' && tag.TagValue === uncertain),
    )!;
    const recovered = await store.provision(accounts[0], uncertain, lost.arn);
    assert.equal(recovered.state, 'pending');
    assert.equal(fixture.state.creates, creations);
    published.set(recovered.key_id, {
      id: recovered.key_id,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: recovered.public_jwk,
    });
    relationships.authentication.push(recovered.key_id);
    await store.activate(accounts[0], organizations[2], recovered.key_id, null);
    const signer = await postgresKmsIssuerSigning(database, fixture.client)(did, organizations[2]);
    assert.equal(
      signer.kid,
      active.key_id,
      'DID authentication keys must never become credential signers.',
    );
    assert.equal((await signer.sign(fixture.state.signingInput)).length, 64);
    await assert.rejects(store.confirmIssuer(accounts[0], organizations[2], 'accreditation'), {
      reason: 'AccreditationConfiguration',
    });
    const checks: string[] = [];
    let rejectAccreditation = true;
    const confirmed = postgresKeyManagement(database, {
      kms: provider,
      dids,
      schemaAddress: (id) => 'https://schemas.example/' + id,
      ensureAccredited: async (issuer, type, context) => {
        assert.equal(issuer, did);
        assert.equal(context.attribute, 'accreditation');
        assert.ok(context.schemaId.startsWith('https://schemas.example/key-schema-'));
        checks.push(type);
        if (rejectAccreditation && context.schemaId.endsWith('-1'))
          throw new Error('Synthetic TIR unavailable.');
      },
    });
    await assert.rejects(confirmed.confirmIssuer(accounts[0], organizations[2], 'accreditation'), {
      reason: 'PublishedGrantRequired',
    });
    for (const [index, schema] of schemaIds.entries()) {
      await database.query(
        'INSERT INTO certificate_schemas (id,credential_type,name_sk) VALUES ($1,$2,$3)',
        [schema, 'KeySchema' + index + schema.replace(/-/g, ''), 'Key schema'],
      );
      await database.query(
        "INSERT INTO certificate_schema_versions (schema_id,version,fields,tsr_id,registered_at) VALUES ($1,1,'[]',$2,now())",
        [schema, 'key-schema-' + index],
      );
      await database.query('INSERT INTO organization_certificate_schemas VALUES ($1,$3),($2,$3)', [
        organizations[1],
        organizations[2],
        schema,
      ]);
    }
    await assert.rejects(
      confirmed.confirmIssuer(accounts[0], organizations[2], 'accreditation'),
      /TIR unavailable/,
    );
    assert.equal(
      (
        await database.query('SELECT tir_attribute_id FROM accredited_organizations WHERE id=$1', [
          organizations[2],
        ])
      ).rows[0].tir_attribute_id,
      null,
    );
    rejectAccreditation = false;
    assert.equal(
      (await confirmed.confirmIssuer(accounts[0], organizations[2], 'accreditation'))
        .verified_schemas.length,
      2,
    );
    assert.equal(
      (
        await database.query('SELECT tir_attribute_id FROM accredited_organizations WHERE id=$1', [
          organizations[2],
        ])
      ).rows[0].tir_attribute_id,
      'accreditation',
    );
    assert.ok(checks.length >= 3);
    lost.enabled = false;
    await assert.rejects(provider.inspect(lost.arn, 'did_authentication'), /not enabled/);
    fixture.state.attempts = 2;
    await assert.rejects(provider.create('credential_signing', randomUUID()), /maxAttempts=1/);
    assert.equal(fixture.state.creates, creations);
    await store.retire(accounts[0], organizations[2], recovered.key_id);
    assert.equal(
      (await store.retire(accounts[0], organizations[2], recovered.key_id)).state,
      'retired',
    );
    const journal = (
      await database.query('SELECT event,detail FROM audit_entries WHERE actor_id=$1', [
        accounts[0],
      ])
    ).rows;
    assert.ok(journal.some((event) => event.event === 'key.creation_started'));
    assert.ok(journal.some((event) => event.event === 'key.creation_completed'));
    assert.equal(
      journal.filter(
        (event) => event.event === 'key.activated' && event.detail.kid === first.key_id,
      ).length,
      1,
    );
    assert.equal(JSON.stringify(journal).includes('PRIVATE KEY'), false);
    assert.equal(JSON.stringify(journal).includes('arn:'), false);
    await database.query(
      "UPDATE accredited_organizations SET revoked_at=now(),revocation_reason='breach' WHERE id=$1",
      [organizations[1]],
    );
    await assert.rejects(
      store.attach(accounts[0], organizations[2], 'credential_signing', originalArn),
      { reason: 'OrganizationUnavailable' },
    );
  } finally {
    await database.query(
      'DELETE FROM signing_key_provisions WHERE organization_id=ANY($1::uuid[])',
      [organizations],
    );
    await database.query('DELETE FROM issuer_signing_keys WHERE organization_id=ANY($1::uuid[])', [
      organizations,
    ]);
    await database.query('DELETE FROM accredited_organizations WHERE id=ANY($1::uuid[])', [
      organizations,
    ]);
    await database.query(
      'DELETE FROM certificate_schema_versions WHERE schema_id=ANY($1::uuid[])',
      [schemaIds],
    );
    await database.query('DELETE FROM certificate_schemas WHERE id=ANY($1::uuid[])', [schemaIds]);
    await database.query('DELETE FROM operator_accounts WHERE id=ANY($1::integer[])', [accounts]);
    await database.end();
  }
});
