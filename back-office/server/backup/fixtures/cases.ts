import { backupHolder } from './api.ts';
import { backupDigest } from '../proof.ts';

/** One request derived from the backup contract suite or its uncovered proof boundaries. */
export interface BackupCase {
  name: string;
  id: string;
  method: string;
  body?: object | string;
  status: number;
  reason?: string;
}

/**
 * Build the original suite's wire scenarios plus explicit proof and deletion boundaries.
 * @returns Ordered real HTTP calls, with cryptographically signed inputs and expected refusals.
 */
export function backupCases(): BackupCase[] {
  const h = backupHolder();
  const other = backupHolder();
  const cases: BackupCase[] = [];
  const add = (
    name: string,
    method: string,
    body: object | string | undefined,
    status: number,
    reason?: string,
    id = h.id,
  ) => cases.push({ name, id, method, body, status, reason });
  add('unknown read', 'GET', undefined, 404, 'NoBackup');
  add('first upload', 'PUT', h.upload('Y2lwaGVy'), 200);
  add('read ciphertext', 'GET', undefined, 200);
  add('replace latest', 'PUT', h.upload('dHdv', 2), 200);
  for (const version of [1, 2])
    add('old/equal replay', 'PUT', h.upload('b2xk', version), 409, 'StaleVersion');
  add('not key thumbprint', 'PUT', h.upload(), 403, 'NotYourBackup', other.id);
  add(
    'wrong signing key',
    'PUT',
    {
      ...h.upload('YQ', 3),
      proof: h.proof({ version: 3, digest: backupDigest('YQ') }, {}, other.privateKey),
    },
    403,
    'InvalidProof',
  );
  add(
    'tampered ciphertext',
    'PUT',
    { ...h.upload('YQ', 3), ciphertext: 'Yg' },
    400,
    'InvalidProof',
  );
  add('tampered version', 'PUT', { ...h.upload('YQ', 3), version: 4 }, 400, 'InvalidProof');
  for (const iat of [
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000) + 3600,
    'now',
    null,
    1.25,
  ])
    add(
      'stale/invalid iat',
      'PUT',
      h.upload('YQ', 3, { iat }),
      iat === null ? 403 : 400,
      iat === null ? 'InvalidProof' : 'StaleProof',
    );
  add(
    'private header key',
    'PUT',
    {
      ...other.upload(),
      proof: other.proof(
        { version: 1, digest: backupDigest('c2VjcmV0') },
        { jwk: { ...other.jwk, d: 'AQ' } },
      ),
    },
    400,
    'InvalidProof',
    other.id,
  );
  add(
    'stored key ignores header',
    'PUT',
    {
      ...h.upload('YQ', 3),
      proof: h.proof({ version: 3, digest: backupDigest('YQ') }, { jwk: { d: 'ignored' } }),
    },
    200,
  );
  for (const ciphertext of ['', 'abc=', 'a/b', 42, null])
    add('invalid ciphertext', 'PUT', { ...h.upload('YQ', 4), ciphertext }, 400, 'InvalidBackup');
  for (const version of [0, -1, true, '4', 1.5, null])
    add('invalid version', 'PUT', { ...h.upload('YQ', 4), version }, 400, 'InvalidBackup');
  add(
    'float integer version',
    'PUT',
    JSON.stringify(h.upload('YQ', 4)).replace('"version":4', '"version":4.0'),
    400,
    'InvalidBackup',
  );
  add('malformed JWS', 'PUT', { ...h.upload('YQ', 4), proof: 'bad' }, 400, 'InvalidProof');
  add(
    'wrong alg',
    'PUT',
    { ...h.upload('YQ', 4), proof: h.proof({}, { alg: 'HS256' }) },
    400,
    'InvalidProof',
  );
  add(
    'wrong typ',
    'PUT',
    { ...h.upload('YQ', 4), proof: h.proof({}, { typ: 'JWT' }) },
    400,
    'InvalidProof',
  );
  add('wrong backup claim', 'PUT', h.upload('YQ', 4, { backup: other.id }), 400, 'InvalidProof');
  for (const claims of [
    { exp: 1 },
    { nbf: Math.floor(Date.now() / 1000) + 60 },
    { aud: 'x' },
    { sub: 1 },
    { jti: 1 },
  ])
    add('optional registered claim', 'PUT', h.upload('YQ', 4, claims), 403, 'InvalidProof');
  add('malformed JSON', 'PUT', '{not json', 400);
  add('unsigned deletion', 'DELETE', { proof: h.proof() }, 400, 'InvalidProof');
  add(
    'wrong deletion key',
    'DELETE',
    { proof: h.proof({ delete: true }, {}, other.privateKey) },
    403,
    'InvalidProof',
  );
  const deletion = { proof: h.proof({ delete: true }) };
  add('signed deletion', 'DELETE', deletion, 204);
  add('unknown deletion', 'DELETE', {}, 404);
  add('deleted read', 'GET', undefined, 404, 'NoBackup');
  add('backup recreation permits a lower version', 'PUT', h.upload(), 200);
  add('fresh deletion proof can delete a recreated backup', 'DELETE', deletion, 204);
  add('invalid route', 'GET', undefined, 404, undefined, 'bad');
  return cases;
}

/**
 * Remove nondeterministic timestamps only after checking their consumed shape.
 * @param body - Observed JSON response from either implementation.
 * @returns Stable response projection for contract assertions.
 * @throws Error for a malformed response timestamp.
 */
export function stableBackupBody(body: any) {
  if (body && typeof body === 'object' && 'updated_at' in body) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(body.updated_at))
      throw new Error('Invalid backup timestamp');
    return { ...body, updated_at: '<timestamp>' };
  }
  return body;
}
