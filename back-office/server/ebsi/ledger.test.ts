import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Transaction, Wallet, toQuantity } from 'ethers';
import { EbsiLedgerProvider } from './ledger.ts';

const baseFee = 2_456_763n;

/**
 * A Ledger API that, like the pilot's, forwards reads but no fee method.
 * @returns Its URL and a way to close it.
 */
async function pilotLedger() {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const { id, method } = JSON.parse(body);
      const results: Record<string, unknown> = {
        eth_getBlockByNumber: {
          number: '0x10',
          hash: '0x' + '11'.repeat(32),
          parentHash: '0x' + '22'.repeat(32),
          timestamp: '0x1',
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          gasLimit: '0x1fffffffffffff',
          gasUsed: '0x0',
          miner: '0x' + '00'.repeat(20),
          extraData: '0x',
          baseFeePerGas: toQuantity(baseFee),
          transactions: [],
        },
        eth_getTransactionCount: '0x0',
        eth_estimateGas: '0x5208',
      };
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(
          method in results
            ? { jsonrpc: '2.0', id, result: results[method] }
            : { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not allowed' } },
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/ledger/v4/blockchains/besu`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('Without fee methods both legacy and EIP-1559 transactions pay twice the base fee', async () => {
  const ledger = await pilotLedger();
  const provider = new EbsiLedgerProvider(ledger.url, 1337, undefined, { feesFromBlock: true });
  try {
    const fees = await provider.getFeeData();
    assert.equal(fees.gasPrice, baseFee * 2n);
    assert.equal(fees.maxFeePerGas, baseFee * 2n);
    assert.equal(fees.maxPriorityFeePerGas, baseFee);

    // The governance signer asks for EIP-1559; a node with a minimum gas price refuses zero fees.
    const signer = Wallet.createRandom().connect(provider);
    const to = Wallet.createRandom().address;
    const eip1559 = Transaction.from(
      await signer.signTransaction(await signer.populateTransaction({ to, type: 2 })),
    );
    assert.equal(eip1559.maxFeePerGas, baseFee * 2n);
    assert.equal(eip1559.maxPriorityFeePerGas, baseFee);
    const legacy = await signer.populateTransaction({ to, type: 0 });
    assert.equal(legacy.gasPrice, baseFee * 2n);
  } finally {
    provider.destroy();
    await ledger.close();
  }
});
