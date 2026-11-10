import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actualBackupWallet } from './fixtures/wallet.ts';
import { backupApi } from './fixtures/api.ts';

test('actual Wallet upload/download/decrypt/phrase restore, merge, stale retry and pending sign-in over real API', async (t) => {
  const api = await backupApi();
  t.after(() => api.close());
  const wallet = await actualBackupWallet();
  wallet.setOrigin(api.origin);
  const phrase =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const identity = wallet.identityKeyOf(phrase);
  const keys = wallet.backupKeys(identity);
  await wallet.restoreWallet(phrase, '1234');
  await wallet.storage.storeBool('isWalletCreated', true);
  const original = await wallet.getKeychainDataObject();
  await wallet.setKeychainDataObject({
    ...original,
    did: { ebsi: 'did:key:private-holder' },
    credentials: [
      { id: 'remote', secret: 'private-credential' },
      { id: 'same', label: 'remote' },
    ],
    presentations: [{ id: 'remote-vp' }],
    deferred_credentials: [{ acceptance_token: 'remote-deferred' }],
    actionLogs: [{ id: 'remote-log', actionType: 'shared', date: '2026-01-01T00:00:00.000Z' }],
  });
  await wallet.markBackupReady();
  assert.equal(await wallet.uploadBackup(), 'uploaded');
  const read = await api.call(keys.backupId);
  assert.equal(read.status, 200);
  const content = JSON.parse(wallet.open(keys, read.body.ciphertext));
  assert.equal(content.credentials[0].secret, 'private-credential');
  assert.equal(content.did, undefined);
  assert.equal(content.encryptedPrivateKey, undefined);
  const row = (
    await api.database.query('SELECT * FROM plr_walletbackup WHERE backup_id=$1', [keys.backupId])
  ).rows[0];
  const serialized = JSON.stringify(row);
  for (const secret of [phrase, identity, 'private-credential', 'did:key:private-holder'])
    assert.equal(serialized.includes(secret), false);

  // The restore screen downloads/decrypts before installing an identity.
  await wallet.resetGenericPassword();
  await wallet.storage.clearAll();
  wallet.SessionPin.clear();
  const downloaded = await wallet.downloadBackup(wallet.backupKeys(wallet.identityKeyOf(phrase)));
  assert.ok(downloaded);
  assert.equal(await wallet.getKeychainDataObject(), null);
  await wallet.markRestoring();
  assert.equal(await wallet.uploadBackup(), 'not-ready');
  await wallet.restoreWallet(phrase, '5678');
  assert.equal(await wallet.getPrivateKey(), identity);
  await wallet.setKeychainDataObject({
    ...(await wallet.getKeychainDataObject()),
    credentials: [{ id: 'local' }, { id: 'same', label: 'local wins' }],
    presentations: [{ id: 'local-vp' }],
    deferred_credentials: [{ acceptance_token: 'local-deferred' }],
    actionLogs: [{ id: 'local-log', actionType: 'added', date: '2026-01-02T00:00:00.000Z' }],
  });
  assert.equal(await wallet.mergeBackup(downloaded), 3);
  const restored = await wallet.getKeychainDataObject();
  assert.deepEqual(
    restored.credentials.map((c: any) => c.id),
    ['remote', 'same', 'local'],
  );
  assert.equal(restored.credentials[1].label, 'local wins');
  assert.equal(restored.presentations.length, 2);
  assert.equal(restored.deferred_credentials.length, 2);
  assert.equal(restored.actionLogs.length, 2);
  await wallet.markBackupReady();

  // The real server returns 409 and actual Wallet code retries at kept+1.
  const future = Date.now() + 1_000_000;
  const ciphertext = wallet.seal(keys, JSON.stringify(content));
  assert.equal(
    (
      await api.call(keys.backupId, 'PUT', {
        ciphertext,
        version: future,
        proof: wallet.proof(keys, { version: future, digest: wallet.digest(ciphertext) }),
      })
    ).status,
    200,
  );
  assert.equal(await wallet.uploadBackup(), 'uploaded');
  assert.equal((await api.call(keys.backupId)).body.version, future + 1);

  // Corruption is read through HTTP and fails actual Wallet GCM authentication.
  const saved = (await api.call(keys.backupId)).body.ciphertext;
  await api.database.query('UPDATE plr_walletbackup SET ciphertext=$2 WHERE backup_id=$1', [
    keys.backupId,
    saved.slice(0, 45) + (saved[45] === 'A' ? 'B' : 'A') + saved.slice(46),
  ]);
  await assert.rejects(wallet.downloadBackup(keys));
  await api.database.query('UPDATE plr_walletbackup SET ciphertext=$2 WHERE backup_id=$1', [
    keys.backupId,
    saved,
  ]);

  // Interrupted restore is resumed by the sign-in backup service, with the session PIN.
  await wallet.markRestoring();
  wallet.SessionPin.clear();
  await assert.rejects(wallet.restoreBackup(), /locked/);
  assert.equal(await wallet.isRestorePending(), true);
  wallet.SessionPin.set('5678');
  assert.deepEqual(await wallet.restoreBackup(), { found: true, credentials: 3 });
  assert.equal(await wallet.isRestorePending(), false);
  wallet.SessionPin.clear();
  assert.equal(await wallet.uploadBackup(), 'locked');

  // An actual backup throttle refusal must not masquerade as an absent backup.
  const throttled = await backupApi({ rate: '0/min' });
  t.after(() => throttled.close());
  wallet.setOrigin(throttled.origin);
  wallet.SessionPin.set('5678');
  await assert.rejects(wallet.downloadBackup(keys), wallet.BackupUnavailable);
  await wallet.markRestoring();
  await wallet.resumeBackups();
  assert.equal(await wallet.isRestorePending(), true);

  // API unavailable before installation leaves existing keychain content untouched.
  const before = await wallet.getKeychainDataObject();
  wallet.setOrigin('http://127.0.0.1:1');
  await assert.rejects(wallet.downloadBackup(keys), wallet.BackupUnavailable);
  assert.deepEqual(await wallet.getKeychainDataObject(), before);
  await wallet.markRestoring();
  await wallet.resumeBackups();
  assert.equal(await wallet.isRestorePending(), true);
  assert.equal(await wallet.uploadBackup(), 'not-ready');
  wallet.setOrigin(api.origin);
  wallet.SessionPin.set('5678');
  await wallet.resumeBackups();
  assert.equal(await wallet.isRestorePending(), false);
  // Let the unchanged sign-in service's scheduled upload finish before closing HTTP.
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(await wallet.uploadBackup(), 'uploaded');
  assert.equal(
    (await api.call(keys.backupId, 'DELETE', { proof: wallet.proof(keys, { delete: true }) }))
      .status,
    204,
  );
  assert.equal(await wallet.downloadBackup(keys), null);
  await wallet.markRestoring();
  assert.deepEqual(await wallet.restoreBackup(), { found: false, credentials: 3 });
  wallet.setOrigin('');
  assert.equal(await wallet.uploadBackup(), 'unconfigured');
});
