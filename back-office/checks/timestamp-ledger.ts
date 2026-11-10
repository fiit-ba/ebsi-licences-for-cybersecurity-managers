import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Wallet, Transaction, keccak256 } from 'ethers';
import { timestampLedger, timestampId } from '../server/audit/timestamp-ledger.ts';
import { testLedger } from '../server/lifecycle/fixtures/ledger.ts';

// The Back Office's timestamp adapter against the Timestamp contract as deployed (contracts/,
// EBSI's commit-reveal timestamping), on the test ledger: BACK_OFFICE_TEST_LEDGER, or one
// started here.
const network = await testLedger();
const { provider, chainId } = network;
const address = network.timestamp;
const wallet = new Wallet(Wallet.createRandom().privateKey, provider);
await network.fund(wallet.address);
const options = { chainId, address, confirmations: 50, gasPrice: 10_000_000_000n };
const ledger = await timestampLedger({ ...options, signer: wallet });
// Fresh digests: the test ledger keeps every earlier run's timestamps.
const digest = '0x' + randomBytes(32).toString('hex');
assert.equal(timestampId(digest).length, 47);
// Public v4 read sample, checked independently against the pilot REST API.
assert.equal(
  timestampId(
    '0x' +
      Buffer.from('EiDETHng4fH0phpYDTFGwTZXpmIvzC9YbGMpfHZyKmBJ/w', 'base64')
        .subarray(2)
        .toString('hex'),
  ),
  'uEiCyzskEVXTNJVok_wI3wHty3LIJ3Apz_4HDocgAUtKGjg',
);

assert.deepEqual(await ledger.observe(digest), { state: 'missing' });
const signed = await ledger.prepare(digest);
for (const [raw, nonce] of [
  [signed.commitRaw, Number(signed.nonce) - 1],
  [signed.raw, Number(signed.nonce)],
] as const) {
  const parsed = Transaction.from(raw);
  assert.equal(parsed.to, address);
  assert.equal(parsed.from, wallet.address);
  assert.equal(parsed.value, 0n);
  assert.equal(parsed.nonce, nonce);
}
assert.equal(keccak256(signed.raw), signed.hash);
assert.equal(keccak256(signed.commitRaw), signed.commitHash);
await assert.rejects(
  ledger.broadcast('0x' + randomBytes(32).toString('hex'), signed),
  /durable intent/,
);
await ledger.broadcast(digest, signed);
assert.deepEqual(await ledger.observe(digest), { state: 'pending' });
await network.mine(50);
const observed = await ledger.observe(digest);
if (observed.state !== 'confirmed') assert.fail('Expected confirmed timestamp evidence.');
assert.equal(
  observed.proof.blockHash,
  (await provider.getBlock(Number(observed.proof.blockNumber)))!.hash,
);
assert.deepEqual(await ledger.observe(digest), observed);
// A retry after delivery sends nothing new and changes nothing.
await ledger.broadcast(digest, signed);
assert.deepEqual(await ledger.observe(digest), observed);
await assert.rejects(
  timestampLedger({ ...options, chainId: chainId + 1, signer: wallet }),
  /chain ID/,
);

// Another key's timestamp of a digest is not this installation's evidence.
const other = new Wallet(Wallet.createRandom().privateKey, provider);
await network.fund(other.address);
const foreign = '0x' + randomBytes(32).toString('hex');
const otherLedger = await timestampLedger({ ...options, signer: other });
await otherLedger.broadcast(foreign, await otherLedger.prepare(foreign));
await assert.rejects(ledger.observe(foreign), /does not match/);

const parsed = Transaction.from(signed.raw);
const maliciousRaw = await wallet.signTransaction({
  chainId,
  type: 0,
  to: address,
  value: 1n,
  data: parsed.data,
  gasLimit: parsed.gasLimit,
  gasPrice: parsed.gasPrice,
  nonce: Number(signed.nonce) + 1,
});
await assert.rejects(
  ledger.broadcast(digest, {
    ...signed,
    raw: maliciousRaw,
    hash: keccak256(maliciousRaw),
    nonce: String(Number(signed.nonce) + 1),
  }),
  /durable intent/,
);
console.log(
  'Anvil confirmed commit-reveal timestamp transactions, confirmation depth, bounded signing and exact external evidence.',
);
provider.destroy();
