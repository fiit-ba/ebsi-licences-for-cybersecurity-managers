import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { issuanceProtection } from '../server/issuance/protection.ts';
import { configuredFieldProtection, fieldKeyContext } from '../server/keys/field-protection.ts';
import { bootstrapFieldKeys } from '../server/keys/field-bootstrap.ts';
import { storeReason, openReason } from '../server/lifecycle/reason-storage.ts';

if (
  process.env.ATEST_INSTALLATION_TEST !== 'isolated' ||
  process.env.PGDATABASE !== 'atest_field_key_transition'
)
  throw new Error('Use only the disposable field-key transition database.');
const database = new pg.Pool();
const kms = new KMSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.PLR_KMS_ENDPOINT_URL,
  maxAttempts: 1,
});
const key = Buffer.alloc(32, 123); // Public synthetic unversioned-envelope fixture, never deployment material.
const old = issuanceProtection(key);
const phase = process.argv[2];
const id = 'c86946bc-422d-4896-a692-3e071f0e530e';
const reasonId = '445d346b-c2d5-4f85-b541-71cbe2cbec66';
const did = 'did:ebsi:zSyntheticTransition';
const state = 'T'.repeat(43);
const proofFile = join(tmpdir(), 'atest-field-key-transition-proof.json');
const fields = configuredFieldProtection(database);
try {
  if (phase === 'prepare') {
    const actor = (
      await database.query(
        "INSERT INTO operator_accounts(username,password_hash) VALUES ('transition','synthetic-unused') RETURNING id",
      )
    ).rows[0].id;
    const organization = (
      await database.query(
        "INSERT INTO accredited_organizations(name,kind,account_id) VALUES ('Transition','rtao',$1) RETURNING id",
        [actor],
      )
    ).rows[0].id;
    const schema = (
      await database.query(
        "INSERT INTO certificate_schemas(credential_type,name_sk) VALUES ('TransitionCertificate','Transition') RETURNING id",
      )
    ).rows[0].id;
    await database.query(
      "INSERT INTO certificate_schema_versions(schema_id,version,fields) VALUES ($1,1,'[]')",
      [schema],
    );
    await database.query(
      // Not collected yet (its offer is open): no record key or credential hash.
      `INSERT INTO registered_certificates(id,credential_id,issuer_id,issuer_did,schema_id,schema_version,certificate_number,private_data,created_by)
      VALUES ($1,$2,$3,$4,$5,1,'TRANSITION',$6,$7)`,
      [
        id,
        'urn:uuid:' + id,
        organization,
        did,
        schema,
        old.seal(id, {
          claims: { certificateNumber: 'TRANSITION' },
          holder_reference: 'synthetic',
        }),
        actor,
      ],
    );
    const offer = old.newOffer();
    await database.query(
      'INSERT INTO credential_offers(certificate_id,code_digest,pin_digest,expires_at) VALUES ($1,$2,$3,$4)',
      [id, offer.codeDigest, offer.pinDigest, offer.expiresAt],
    );
    const reason = await storeReason('other', 'private transition note', Buffer.alloc(32, 17), old);
    await database.query(
      `INSERT INTO certificate_status_proposals(id,certificate_id,action,initial_standing,reason_code,reason_note,reason_salt,reason_hash,proposed_by)
      VALUES ($1,$2,'suspend','active',$3,$4,$5,$6,$7)`,
      [
        reasonId,
        id,
        reason.reason_code,
        reason.reason_note,
        reason.reason_salt,
        reason.reason_hash,
        actor,
      ],
    );
    await database.query(
      `INSERT INTO presentation_results(state,verified,outcome,attributes_encrypted,attributes_until) VALUES ($1,true,'VALID',$2,now()+interval '1 day')`,
      [state, old.seal('presentation:' + state, ['private attribute'])],
    );
    const decisionId = randomUUID();
    await database.query(
      `INSERT INTO decision_anchors(id,digest,credential_id,kind,decision_encrypted) VALUES ($1,$2,'synthetic','test',$3)`,
      [decisionId, Buffer.alloc(32, 16), old.seal(decisionId, { decision: 'approved' })],
    );
    await writeFile(
      proofFile,
      JSON.stringify({ code: offer.code, pin: offer.pin, digest: offer.pinDigest.toString('hex') }),
      { mode: 0o600 },
    );
    await assert.rejects(
      bootstrapFieldKeys(database, kms, { development: true }),
      /requires field-keys import-legacy/,
    );
    console.log(
      'Prepared synthetic unversioned ciphertext, active offer, private reason, presentation and immutable decision snapshot.',
    );
  } else if (phase === 'migrate') {
    const offerProof = JSON.parse(await readFile(proofFile, 'utf8'));
    const snapshot = async () =>
      JSON.stringify(
        (
          await database.query(`SELECT jsonb_build_object(
      'certificates',(SELECT jsonb_agg(c) FROM registered_certificates c),
      'offers',(SELECT jsonb_agg(o) FROM credential_offers o),
      'reasons',(SELECT jsonb_agg(p) FROM certificate_status_proposals p),
      'presentations',(SELECT jsonb_agg(p) FROM presentation_results p),
      'decisions',(SELECT jsonb_agg(d) FROM decision_anchors d)) AS state`)
        ).rows,
      );
    const before = await snapshot();
    await assert.rejects(
      bootstrapFieldKeys(database, kms, { development: true }),
      /requires field-keys import-legacy/,
    );
    await assert.rejects(
      bootstrapFieldKeys(database, kms, { development: true, legacyKey: Buffer.alloc(32, 124) }),
      /did not authenticate every/,
    );
    const directory = await mkdtemp(join(tmpdir(), 'atest-key-import-'));
    try {
      const file = join(directory, 'legacy');
      await writeFile(file, key.toString('hex'), { mode: 0o600 });
      execFileSync(process.execPath, ['scripts/field-keys.ts', 'import-legacy', file], {
        env: process.env,
        stdio: 'pipe',
      });
      execFileSync(process.execPath, ['scripts/field-keys.ts', 'import-legacy', file], {
        env: process.env,
        stdio: 'pipe',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    assert.equal(
      await snapshot(),
      before,
      'Import changed protected data, offers or immutable decisions.',
    );
    assert.equal(
      (
        await fields.open(
          id,
          (
            await database.query('SELECT private_data FROM registered_certificates WHERE id=$1', [
              id,
            ])
          ).rows[0].private_data,
        )
      ).claims.certificateNumber,
      'TRANSITION',
    );
    // The stable secret's derivations survive the transition.
    const salt = await fields.commitmentSalt(id);
    assert.equal(salt.toString('hex'), old.commitmentSalt(id).toString('hex'));
    assert.equal(
      await fields.matchesPin(
        offerProof.code,
        offerProof.pin,
        (
          await database.query('SELECT pin_digest FROM credential_offers WHERE certificate_id=$1', [
            id,
          ])
        ).rows[0].pin_digest,
      ),
      true,
    );
    const row = (
      await database.query('SELECT * FROM certificate_status_proposals WHERE id=$1', [reasonId])
    ).rows[0];
    assert.equal((await openReason(row, fields)).note, 'private transition note');
    const current = await fields.seal(id, { new: true });
    assert.deepEqual(await fields.open(id, current), { new: true });
    await assert.rejects(fields.open(id + '-wrong', current));
    const altered = Buffer.from(current);
    altered[altered.length - 1] ^= 1;
    await assert.rejects(fields.open(id, altered));
    assert.throws(() => old.open(id, current));
    await database.query(
      `INSERT INTO presentation_results(state,verified,outcome,attributes_encrypted,attributes_until) VALUES ($1,true,'VALID',$2,now()+interval '1 day')`,
      ['U'.repeat(43), await fields.seal('presentation:' + 'U'.repeat(43), { new: true })],
    );
    const stored = (await database.query('SELECT * FROM field_keys')).rows[0];
    await assert.rejects(
      kms.send(
        new DecryptCommand({
          KeyId: stored.kms_key_id,
          CiphertextBlob: stored.encryption_wrapped,
          EncryptionContext: fieldKeyContext(stored.installation_id, 'derivation'),
        }),
      ),
    );
    await assert.rejects(database.query("UPDATE field_keys SET kms_key_id='replacement'"));
    await assert.rejects(database.query('TRUNCATE field_keys'));
    console.log(
      'Field-key CLI import/retry, wrong-key refusal, old ciphertext/PIN/reason/commitment continuity, new AES-GCM owner/tamper checks and KMS purpose binding passed.',
    );
  } else if (phase === 'unavailable') {
    const before = JSON.stringify((await database.query('SELECT * FROM field_keys')).rows);
    for (const operation of [
      () => fields.seal(id, {}),
      () => fields.open(id, Buffer.alloc(40)),
      () => fields.newOffer(),
      () => fields.commitmentSalt(id),
      () => fields.matchesPin('code', 'pin', Buffer.alloc(32)),
    ])
      await assert.rejects(operation, (error: any) => error.status === 503);
    await assert.rejects(bootstrapFieldKeys(database, kms, { development: true }));
    assert.equal(JSON.stringify((await database.query('SELECT * FROM field_keys')).rows), before);
    console.log(
      'Cold encryption, decryption, offers, PIN, salt derivation and repeat bootstrap refused unavailable KMS without changing stored keys.',
    );
  } else if (phase === 'read') {
    const row = (
      await database.query('SELECT private_data FROM registered_certificates WHERE id=$1', [id])
    ).rows[0];
    assert.equal((await fields.open(id, row.private_data)).claims.certificateNumber, 'TRANSITION');
    assert.deepEqual(
      await fields.open(
        'presentation:' + 'U'.repeat(43),
        (
          await database.query(
            'SELECT attributes_encrypted FROM presentation_results WHERE state=$1',
            ['U'.repeat(43)],
          )
        ).rows[0].attributes_encrypted,
      ),
      { new: true },
    );
    const proof = JSON.parse(await readFile(proofFile, 'utf8'));
    assert.equal(
      await fields.matchesPin(proof.code, proof.pin, Buffer.from(proof.digest, 'hex')),
      true,
    );
    const limited = new pg.Pool({ ...database.options, max: 1, connectionTimeoutMillis: 1000 });
    const occupied = await limited.connect();
    const cold = configuredFieldProtection(limited);
    try {
      await occupied.query('BEGIN');
      assert.equal((await cold.open(id, row.private_data)).claims.certificateNumber, 'TRANSITION');
      await occupied.query('ROLLBACK');
    } finally {
      cold.close();
      occupied.release();
      await limited.end();
    }
    console.log(
      'Cold runtime read old/new ciphertext and PIN after restart, including an occupied one-connection business pool.',
    );
  } else throw new Error('Expected prepare, migrate, read or unavailable.');
} finally {
  key.fill(0);
  fields.close();
  kms.destroy();
  await database.end();
}
