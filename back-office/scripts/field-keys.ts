import { open } from 'node:fs/promises';
import { KMSClient } from '@aws-sdk/client-kms';
import pg from 'pg';
import { bootstrapFieldKeys } from '../server/keys/field-bootstrap.ts';

const [command, file, ...extra] = process.argv.slice(2);
if (
  !['bootstrap', 'import-legacy'].includes(command ?? '') ||
  extra.length ||
  (command === 'import-legacy') !== Boolean(file)
)
  throw new Error('Usage: npm run keys:fields -- bootstrap | import-legacy /private/key-file');
if (process.env.BACK_OFFICE_ISSUANCE_KEY)
  throw new Error(
    'Supply the former key only in the private import file; remove BACK_OFFICE_ISSUANCE_KEY from the command environment.',
  );
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const kms = new KMSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.PLR_KMS_ENDPOINT_URL || undefined,
  maxAttempts: 1,
});
let legacyKey: Buffer | undefined;
try {
  if (file) {
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > 128)
        throw new Error(
          'Use a private regular file with permissions 0600 containing exactly the former 64 hexadecimal characters.',
        );
      const bytes = await handle.readFile();
      try {
        const value = bytes.toString('utf8').trim();
        if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid legacy key file.');
        legacyKey = Buffer.from(value, 'hex');
      } finally {
        bytes.fill(0);
      }
    } finally {
      await handle.close();
    }
  }
  console.log(
    JSON.stringify(
      await bootstrapFieldKeys(database, kms, {
        kmsKeyId: process.env.PLR_FIELD_KMS_KEY_ID || undefined,
        development:
          process.env.BACK_OFFICE_DEVELOPMENT === 'true' && Boolean(process.env.PLR_EBSI_MOCK_URL),
        legacyKey,
      }),
    ),
  );
} finally {
  legacyKey?.fill(0);
  kms.destroy();
  await database.end();
}
