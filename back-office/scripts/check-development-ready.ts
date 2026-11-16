import { configuredFieldProtection } from '../server/keys/field-protection.ts';
import pg from 'pg';
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { Contract, JsonRpcProvider } from 'ethers';
import { GOVERNANCE_ABI, REGISTRY_ABI } from '../shared/governance-contract.ts';
import { jwkAddress } from '../server/ebsi/runtime.ts';
import { tiIdOf } from '../server/lifecycle/ti-governance.ts';

if (process.env.BACK_OFFICE_DEVELOPMENT !== 'true')
  throw new Error('Development readiness requires the local Compose environment.');
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const kms = new KMSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.PLR_KMS_ENDPOINT_URL,
});
const provider = new JsonRpcProvider(process.env.PLR_LEDGER_RPC_URL);
const protection = configuredFieldProtection(database);
try {
  const probe = await protection.seal('bootstrap-readiness', { ready: true });
  if (!(await protection.open('bootstrap-readiness', probe)).ready)
    throw new Error('Field-key readiness failed.');
  if ((await provider.getNetwork()).chainId !== BigInt(process.env.PLR_LEDGER_CHAIN_ID!))
    throw new Error('The governance ledger chain does not match configuration.');
  const governance = new Contract(process.env.PLR_GOVERNANCE_CONTRACT!, GOVERNANCE_ABI, provider);
  const registry = new Contract(process.env.PLR_CERTIFICATE_REGISTRY!, REGISTRY_ABI, provider);
  if ((await registry.governance()) !== (await governance.getAddress()))
    throw new Error(
      'The certificate registry does not take its decisions from this governance contract.',
    );
  const keys = (await database.query('SELECT kms_key_id FROM issuer_signing_keys WHERE active'))
    .rows;
  for (const row of keys)
    await kms.send(new GetPublicKeyCommand({ KeyId: row.kms_key_id }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
  // Each configured TI signs with its own A and B keys, which must hold those roles now.
  const signers = (
    await database.query(
      `SELECT o.did,k.purpose,k.public_jwk FROM accredited_organizations o JOIN issuer_signing_keys k ON k.organization_id=o.id
       WHERE o.kind='ti' AND o.governance_configured_at IS NOT NULL AND k.active
         AND k.purpose IN ('governance_role_a','governance_role_b') ORDER BY o.did,k.purpose`,
    )
  ).rows;
  if (!signers.length) throw new Error('No TI is set up on the governance contract.');
  for (const row of signers)
    if (
      Number(await governance.roleOf(tiIdOf(row.did), jwkAddress(row.public_jwk))) !==
      (row.purpose === 'governance_role_a' ? 1 : 2)
    )
      throw new Error(`A ${row.purpose} key of ${row.did} does not hold its role on the contract.`);
  const status = await registry.certificateStatus('0x' + '00'.repeat(32));
  if (Number(status.standing ?? status[0]) !== 0)
    throw new Error('Unexpected standing for the unknown certificate.');
  console.log(
    JSON.stringify({
      standing: 'none',
      keys: keys.length,
      tis: new Set(signers.map((row) => row.did)).size,
    }),
  );
} finally {
  kms.destroy();
  protection.close();
  provider.destroy();
  await database.end();
}
