import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Contract, HDNodeWallet, Wallet } from 'ethers';
import pg from 'pg';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../../shared/governance-contract.ts';
import { testLedger } from './fixtures/ledger.ts';
import {
  contractTemplates,
  factoryDeployments,
  taoContractDeployment,
  taoContractDirectory,
} from './tao-contracts.ts';
import { certificateRegistries, UntrustedRegistry } from '../verification/registry-trust.ts';

test("each TAO gets its own pair through EBSI's Proxy Factory, and verifiers recognise it as that TAO's", async () => {
  assert.equal(process.env.PGDATABASE, 'atest_back_office_test');
  const database = new pg.Pool();
  const network = await testLedger();
  const { provider } = network;
  // The development deployer (contracts/scripts/Networks.sol, key 0) deploys from the factory.
  const deployer = HDNodeWallet.fromPhrase(
    'test test test test test test test test test test test junk',
    undefined,
    "m/44'/60'/0'/0/0",
  ).connect(provider);
  const owners = new Map<string, HDNodeWallet>();
  const suffix = randomUUID()
    .replaceAll('-', '')
    .slice(0, 20)
    .replace(/[0lIO]/g, 'x');
  try {
    const {
      rows: [root],
    } = await database.query(
      "INSERT INTO accredited_organizations (name, kind) VALUES ($1, 'rtao') RETURNING id",
      ['Root ' + suffix],
    );
    const taos = [];
    for (const index of [1, 2]) {
      const did = `did:ebsi:zTao${index}${suffix}`;
      const {
        rows: [tao],
      } = await database.query(
        "INSERT INTO accredited_organizations (name, kind, parent_id, did) VALUES ($1, 'tao', $2, $3) RETURNING id",
        [`TAO ${index} ${suffix}`, root.id, did],
      );
      const owner = Wallet.createRandom().connect(provider);
      await network.fund(owner.address);
      owners.set(tao.id, owner);
      taos.push({ id: tao.id as string, did });
    }
    const templates = contractTemplates(undefined);
    const deployment = taoContractDeployment(database, {
      provider,
      factory: network.proxyFactory,
      templates,
      deployer: async () => ({ signer: deployer, did: '' }),
      owner: async (taoId) => owners.get(taoId)!,
    });

    const pairs = [];
    for (const tao of taos) {
      const pair = await deployment.ensure(tao.id);
      pairs.push(pair);
      const registry = new Contract(pair.registry, REGISTRY_ABI, provider);
      const governance = new Contract(pair.governance, GOVERNANCE_ABI, provider);
      // The TAO's own key owns both, and the two name each other.
      assert.equal(await registry.governance(), pair.governance);
      assert.equal(await governance.certificateRegistry(), pair.registry);
      assert.equal(await governance.taoDid(), tao.did);
      assert.equal(await governance.owner(), owners.get(tao.id)!.address);
      assert.equal(await registry.owner(), owners.get(tao.id)!.address);
      // Asked again, the recorded pair: nothing is deployed twice.
      assert.deepEqual(await deployment.ensure(tao.id), pair);
    }
    assert.notEqual(pairs[0].registry, pairs[1].registry);
    assert.deepEqual(
      (await taoContractDirectory(database).byContract(pairs[1].governance))?.taoDid,
      taos[1].did,
    );

    // Each is a Trusted Contract (deployed by the factory) before and after it is recorded.
    const trusted = factoryDeployments(provider, network.proxyFactory);
    assert.equal(await trusted(pairs[0].registry), true);
    assert.equal(await trusted(pairs[1].governance), true);
    assert.equal(await trusted('0x' + '12'.repeat(20)), false);

    const registries = certificateRegistries({
      provider,
      chainId: network.chainId,
      factory: network.proxyFactory,
      templates,
    });
    // Each registry is its own TAO's, and no other TAO's.
    await registries.trust(pairs[0].registry, taos[0].did);
    await registries.trust(pairs[1].registry, taos[1].did);
    await assert.rejects(registries.trust(pairs[0].registry, taos[1].did), UntrustedRegistry);
    // The installation's first pair, deployed through the factory by Deploy.s.sol, is its TAO's.
    await registries.trust(network.registry, network.taoDid);
    // A governance contract is not a registry, and an arbitrary address is neither.
    await assert.rejects(registries.trust(pairs[0].governance, taos[0].did), UntrustedRegistry);
    await assert.rejects(registries.trust('0x' + '12'.repeat(20), taos[0].did), UntrustedRegistry);
  } finally {
    await database.end();
  }
});
