import assert from 'node:assert/strict';
import { createPublicKey, randomUUID } from 'node:crypto';
import { Contract, getBytes, hexlify } from 'ethers';
import { governanceActions } from '../server/lifecycle/governance.ts';
import { emergencyLedger } from '../server/lifecycle/emergency-ledger.ts';
import { kmsLedgerSigner } from '../server/issuance/kms-ledger-signer.ts';
import { governanceLedger } from '../server/issuance/governance-ledger.ts';
import { certificateStatusKey } from '../server/issuance/protection.ts';
import type { KmsSigningClient } from '../server/issuance/kms-types.ts';
import { testLedger } from '../server/lifecycle/fixtures/ledger.ts';

// The Back Office's certificate registry and governance adapters against the contracts as
// deployed (contracts/), on the test ledger: BACK_OFFICE_TEST_LEDGER, or one started here.
const network = await testLedger();
const { provider, chainId } = network;
const ti = await network.newTi();
const [wallet, roleB] = ti.keys;

// The TI's A key, held by a fake KMS that signs digests as AWS KMS does.
const coordinates = Buffer.from(getBytes(wallet.signingKey.publicKey));
const publicKey = createPublicKey({
  key: {
    kty: 'EC',
    crv: 'secp256k1',
    x: coordinates.subarray(1, 33).toString('base64url'),
    y: coordinates.subarray(33).toString('base64url'),
  },
  format: 'jwk',
}).export({ format: 'der', type: 'spki' });
/**
 * DER-encode one ECDSA scalar.
 * @param value - The scalar, 0x-hex.
 * @returns Its DER INTEGER.
 */
function derScalar(value: string) {
  let bytes = Buffer.from(getBytes(value));
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([2, bytes.length]), bytes]);
}
const kms: KmsSigningClient = {
  async send(command) {
    if (command.input.KeyId === 'alias/test') {
      return {
        KeyId: 'stable-key',
        KeySpec: 'ECC_SECG_P256K1',
        KeyUsage: 'SIGN_VERIFY',
        PublicKey: publicKey,
      };
    }
    assert.equal(command.input.KeyId, 'stable-key');
    assert.ok('MessageType' in command.input);
    assert.equal(command.input.MessageType, 'DIGEST');
    const { r, s } = wallet.signingKey.sign(hexlify(command.input.Message!));
    const scalars = Buffer.concat([derScalar(r), derScalar(s)]);
    return {
      Signature: Buffer.concat([Buffer.from([0x30, scalars.length]), scalars]),
      SigningAlgorithm: 'ECDSA_SHA_256',
    };
  },
};
const signer = await kmsLedgerSigner({ provider, kms, keyId: 'alias/test', chainId });
assert.equal(await signer.getAddress(), wallet.address);
const registry = network.registryContract;
const ledger = governanceLedger({
  chainId,
  address: network.registry,
  provider,
  signerFor: async () => signer,
});

/**
 * A collected certificate of the TI, as its record is registered.
 * @param credentialHash - Hash of its JWT.
 * @returns The intended registration.
 */
function certificate(credentialHash: string) {
  const id = 'urn:uuid:' + randomUUID();
  return {
    id,
    issuer: ti.did,
    statusKey: '0x' + certificateStatusKey(ti.did, id).toString('hex'),
    credentialHash,
    validFrom: 1767225600,
    validUntil: 1893456000,
  };
}

const record = certificate('0x' + '17'.repeat(32));
await ledger.ensureRegistered(record);
const first = await registry.certificateStatus(record.statusKey);
assert.equal(first.issuerDid, record.issuer);
assert.equal(first.credentialHash, record.credentialHash);
// A depth the chain has not reached yet; the test ledger keeps mining, so it is far ahead.
const deep = governanceLedger({
  chainId,
  address: network.registry,
  provider,
  signerFor: async () => signer,
  confirmations: 50,
});
await assert.rejects(deep.ensureRegistered(record), /awaiting confirmations/);
await network.mine(50);
await deep.ensureRegistered(record);
await ledger.ensureRegistered(record);
assert.equal((await registry.certificateStatus(record.statusKey)).registeredAt, first.registeredAt);
await assert.rejects(
  ledger.ensureRegistered({ ...record, validUntil: record.validUntil + 1 }),
  /different record/,
);
const wrongNetwork = governanceLedger({
  chainId: chainId + 1,
  address: network.registry,
  provider,
  signerFor: async () => signer,
});
await assert.rejects(wrongNetwork.ensureRegistered(record), /chain ID/);

const lostRecord = certificate('0x' + '21'.repeat(32));
let broadcasts = 0;
const uncertainSigner = new Proxy(signer, {
  get(target, property) {
    if (property === 'sendTransaction')
      return async (input: Parameters<typeof target.sendTransaction>[0]) => {
        broadcasts++;
        const tx = await target.sendTransaction(input);
        await tx.wait();
        throw new Error('Injected response loss after mined registration');
      };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const uncertainLedger = governanceLedger({
  chainId,
  address: network.registry,
  provider,
  signerFor: async () => uncertainSigner,
});
await uncertainLedger.ensureRegistered(lostRecord);
await uncertainLedger.ensureRegistered(lostRecord);
assert.equal(broadcasts, 1);
assert.equal(
  (await registry.certificateStatus(lostRecord.statusKey)).credentialHash,
  lostRecord.credentialHash,
);
console.log(
  'Anvil confirmed exact registration recovery after a lost mined transaction response, without rebroadcast.',
);
const suspender = new Contract(
  network.registry,
  ['function suspendNow(bytes32 statusKey, bytes32 reasonHash)'],
  signer,
);
await (await suspender.suspendNow(record.statusKey, '0x' + '31'.repeat(32))).wait();
await assert.rejects(ledger.ensureRegistered(record), /different record/);
console.log(
  'Anvil confirmed registration, retry, confirmation depth, mismatch, wrong network and suspended standing.',
);

const secondRecord = certificate('0x' + '18'.repeat(32));
await ledger.ensureRegistered(secondRecord);
const actions = governanceActions({
  chainId,
  address: network.governance,
  registry: network.registry,
  provider,
  signersFor: async () => ({ proposer: signer, approver: roleB }),
  fromBlock: 0,
});
const case_ = {
  action: 'suspend' as const,
  reasonHash: '0x' + '32'.repeat(32),
  onchainId: null,
  statusKey: secondRecord.statusKey,
  credentialId: secondRecord.id,
  issuerDid: ti.did,
  credentialHash: secondRecord.credentialHash,
};
const suspended = await actions.advance(case_);
assert.equal(suspended.state, 'executed');
assert.equal((await registry.certificateStatus(secondRecord.statusKey)).standing, 2n);
assert.deepEqual(await actions.advance(case_), suspended);
await assert.rejects(
  actions.advance({ ...case_, reasonHash: '0x' + '33'.repeat(32), onchainId: suspended.id }),
  /does not match/,
);
const reinstated = await actions.advance({
  ...case_,
  action: 'reinstate',
  reasonHash: '0x' + '34'.repeat(32),
});
assert.equal(reinstated.state, 'executed');
assert.equal((await registry.certificateStatus(secondRecord.statusKey)).standing, 1n);
const revokeCase = { ...case_, action: 'revoke' as const, reasonHash: '0x' + '35'.repeat(32) };
const waiting = await actions.advance(revokeCase);
// Approved by A and B, executable once the pilot's 24 h revocation timelock has passed.
assert.equal(waiting.state, 'approved');
assert.equal((await registry.certificateStatus(secondRecord.statusKey)).standing, 1n);
await network.increaseTime(86401);
const revoked = await actions.advance({ ...revokeCase, onchainId: waiting.id });
assert.equal(revoked.state, 'executed');
assert.equal((await registry.certificateStatus(secondRecord.statusKey)).standing, 3n);
console.log(
  'Anvil confirmed governance suspension, reinstatement, timelocked revocation and retry recovery.',
);

const emergencyRecord = certificate('0x' + '19'.repeat(32));
await ledger.ensureRegistered(emergencyRecord);
// Registered well before the emergency, as a collected certificate is.
await network.mine(50);
const suspension = {
  ...case_,
  credentialId: emergencyRecord.id,
  statusKey: emergencyRecord.statusKey,
  credentialHash: emergencyRecord.credentialHash,
  reasonHash: '0x' + '36'.repeat(32),
};
const emergency = emergencyLedger({
  chainId,
  address: network.registry,
  provider,
  signerFor: async () => signer,
  confirmations: 50,
});
// The transaction succeeds, but its required depth has not been reached. A short timeout
// exercises recovery without slowing the check.
const shallow = emergencyLedger({
  chainId,
  address: network.registry,
  provider,
  signerFor: async () => signer,
  confirmations: 50,
  timeoutMs: 20,
});
await assert.rejects(
  shallow.suspend(suspension),
  (error) =>
    error instanceof Error &&
    (('code' in error && error.code === 'TIMEOUT') || /has not been confirmed/.test(error.message)),
);
assert.equal((await registry.certificateStatus(emergencyRecord.statusKey)).standing, 2n);
await network.mine(50);
await emergency.suspend(suspension);
const recovery = await actions.advance({
  ...suspension,
  action: 'reinstate',
  reasonHash: '0x' + '37'.repeat(32),
});
assert.equal(recovery.state, 'executed');
assert.equal((await registry.certificateStatus(emergencyRecord.statusKey)).standing, 1n);
// A retry of the old emergency must leave the later reinstatement in place.
await emergency.suspend(suspension);
assert.equal((await registry.certificateStatus(emergencyRecord.statusKey)).standing, 1n);
await assert.rejects(
  emergency.suspend({ ...suspension, credentialHash: '0x' + '99'.repeat(32) }),
  /does not match/,
);
await assert.rejects(
  emergencyLedger({
    chainId: chainId + 1,
    address: network.registry,
    provider,
    signerFor: async () => signer,
  }).suspend(suspension),
  /chain ID/,
);
console.log(
  'Anvil confirmed emergency suspension, confirmation depth and recovery after subsequent reinstatement.',
);

const withdrawalRecord = certificate('0x' + '20'.repeat(32));
await ledger.ensureRegistered(withdrawalRecord);
const withdrawalCase = {
  ...case_,
  action: 'revoke' as const,
  credentialId: withdrawalRecord.id,
  statusKey: withdrawalRecord.statusKey,
  credentialHash: withdrawalRecord.credentialHash,
  reasonHash: '0x' + '38'.repeat(32),
};
const openWithdrawal = await actions.advance(withdrawalCase);
assert.equal(openWithdrawal.state, 'approved');
const cancelled = await actions.withdraw(withdrawalCase, '0x' + '39'.repeat(32));
assert.equal(cancelled.state, 'cancelled');
assert.equal(cancelled.id, openWithdrawal.id);
assert.deepEqual(await actions.withdraw(withdrawalCase, '0x' + '39'.repeat(32)), cancelled);
assert.equal((await registry.certificateStatus(withdrawalRecord.statusKey)).standing, 1n);
await assert.rejects(
  actions.withdraw(
    { ...withdrawalCase, reasonHash: '0x' + '40'.repeat(32), onchainId: cancelled.id },
    '0x' + '39'.repeat(32),
  ),
  /does not match/,
);
await assert.rejects(
  actions.withdraw(
    { ...withdrawalCase, reasonHash: '0x' + '41'.repeat(32) },
    '0x' + '39'.repeat(32),
  ),
  /awaiting reconciliation/,
);
assert.equal((await registry.certificateStatus(withdrawalRecord.statusKey)).standing, 1n);
console.log(
  'Anvil confirmed withdrawal of an approved revocation, exact retry recovery and unresolved-submission protection.',
);
provider.destroy();
