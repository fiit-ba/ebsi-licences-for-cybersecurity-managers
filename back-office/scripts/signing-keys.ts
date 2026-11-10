import { parseArgs } from 'node:util';
import pg from 'pg';
import { didRegistry } from '../server/ebsi/did-registry.ts';
import { postgresKeyManagement } from '../server/keys/management.ts';
import { ceremonyKmsClient, kmsKeyCeremony } from '../server/keys/kms-provider.ts';
import { ebsiIssuerTrust } from '../server/issuance/ebsi-trust.ts';
import { trustedSchemaRegistry } from '../server/schemas/tsr.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    actor: { type: 'string' },
    organization: { type: 'string' },
    purpose: { type: 'string' },
    did: { type: 'string' },
    key: { type: 'string' },
    'request-id': { type: 'string' },
    'expected-active': { type: 'string' },
    'recover-key': { type: 'string' },
    attribute: { type: 'string' },
  },
});
const action = positionals[0];
const actor = Number(values.actor);
if (
  positionals.length !== 1 ||
  !Number.isSafeInteger(actor) ||
  actor < 1 ||
  actor > 2147483647 ||
  !process.env.PLR_DIDR_URL
) {
  throw new Error(
    'Use: npm run keys -- identity|list|plan|provision|attach|activate|retire|confirm-issuer --actor ID [options]; configure PLR_DIDR_URL.',
  );
}

/**
 * Require an explicitly supplied ceremony argument before executing an operation.
 * @param name - Long command-line option name.
 * @returns The nonempty supplied string.
 * @throws Error if the option is absent or empty.
 */
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value) throw new Error('Missing --' + name + '.');
  return value;
}

const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const kms = ceremonyKmsClient();
try {
  const dids = didRegistry({
    identifiersUrl: process.env.PLR_DIDR_URL,
    contractAddress: process.env.PLR_DIDR_CONTRACT,
  });
  const trust =
    process.env.PLR_TIR_URL && process.env.PLR_TRUSTED_ROOT_DIDS
      ? ebsiIssuerTrust({
          tirUrl: process.env.PLR_TIR_URL,
          didRegistryUrl: process.env.PLR_DIDR_URL,
          didRegistryContract: process.env.PLR_DIDR_CONTRACT,
          trustedRoots: process.env.PLR_TRUSTED_ROOT_DIDS.split(',')
            .map((did) => did.trim())
            .filter(Boolean),
        })
      : undefined;
  const schemas = process.env.PLR_TSR_URL
    ? trustedSchemaRegistry(process.env.PLR_TSR_URL)
    : undefined;
  const store = postgresKeyManagement(database, {
    kms: kmsKeyCeremony(kms),
    dids,
    ensureAccredited: trust?.ensureAccredited,
    schemaAddress: schemas?.address,
  });
  let result: unknown;
  switch (action) {
    case 'identity':
      result = await store.identity(actor, required('organization'), required('did'));
      break;
    case 'list':
      result = await store.list(actor, required('organization'));
      break;
    case 'plan':
      result = await store.plan(
        actor,
        required('organization'),
        required('purpose'),
        required('request-id'),
      );
      break;
    case 'provision':
      result = await store.provision(actor, required('request-id'), values['recover-key']);
      break;
    case 'attach':
      result = await store.attach(
        actor,
        required('organization'),
        required('purpose'),
        required('key'),
      );
      break;
    case 'activate':
      result = await store.activate(
        actor,
        required('organization'),
        required('key'),
        required('expected-active') === 'none' ? null : required('expected-active'),
      );
      break;
    case 'retire':
      result = await store.retire(actor, required('organization'), required('key'));
      break;
    case 'confirm-issuer':
      result = await store.confirmIssuer(actor, required('organization'), required('attribute'));
      break;
    default:
      throw new Error('Unknown key ceremony action.');
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  kms.destroy();
  await database.end();
}
