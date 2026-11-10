import { KeyObject, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { credentialVerifier } from '../verification/credential.ts';
import { certificateFinalizer } from './finalizer.ts';
import {
  certificateIdHash,
  certificateStatusKey,
  credentialHash,
  issuanceProtection,
  secretDigest,
} from './protection.ts';

test('finalization signs a holder-bound credential without blocking on background ledger registration', async () => {
  const issuer = 'did:ebsi:zTest';
  const subject = 'did:key:zExampleHolder';
  const number = 'Číslo-42';
  // The record key is the registry's computeStatusKey: SHA-256 over abi.encode of the domain,
  // the TI's DID and the hash of the credential's id (contracts/test/CommitmentInterop.t.sol).
  assert.equal(
    certificateStatusKey(issuer, 'urn:uuid:752bdc2c-83dd-4283-a867-e9f967b84034').toString('hex'),
    'c00fb514b3991b4bf0d0ff2e4eca3d926e060c1b17fe32fac2a56265c17e6a19',
  );
  assert.notEqual(
    certificateIdHash('urn:uuid:a').toString('hex'),
    certificateIdHash('urn:uuid:b').toString('hex'),
  );

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const protection = issuanceProtection(Buffer.alloc(32, 17));
  const contract = '0x' + 'ab'.repeat(20);
  const records = [];
  let validatedCredential;
  const finalize = certificateFinalizer({
    async validateCredential(credential) {
      validatedCredential = credential;
    },
    signingKey: async (did) => {
      assert.equal(did, issuer);
      return {
        kid: issuer + '#current',
        sign: (input) =>
          sign('sha256', input, { key: KeyObject.from(privateKey), dsaEncoding: 'ieee-p1363' }),
      };
    },
    ledger: {
      chainId: 1337,
      contract,
      async ensureRegistered() {
        assert.fail('Signing must not deliver a background ledger registration.');
      },
    },
    protection,
    schemaAddress: (id) => 'https://tsr.example/schemas/' + id,
    ledgerStatusSchema: 'https://tsr.example/schemas/ledger-status',
    accreditationAddress: (did, attribute) =>
      `https://tir.example/issuers/${did}/attributes/${attribute}`,
  });
  const certificate = {
    issuer_id: '910741b4-0d58-48b8-bb9c-abba79da3784',
    id: '752bdc2c-83dd-4283-a867-e9f967b84034',
    credential_id: 'urn:uuid:752bdc2c-83dd-4283-a867-e9f967b84034',
    issuer_did: issuer,
    certificate_number: number,
    credential_type: 'ProfessionalLicense',
    tsr_id: 'professional-license',
    tir_attribute_id: 'approved',
    created_at: new Date(Date.now() - 3600_000),
  };

  const input = {
    certificate,
    claims: { certificateNumber: number, name: 'Private name' },
    subject,
  };
  const [jwt, disclosure, end] = (await finalize(input)).split('~');
  assert.equal(end, '');
  const { payload } = await jwtVerify(jwt, publicKey, { issuer, subject, algorithms: ['ES256'] });
  // The record the registry keeps once the holder collected the credential.
  const record = {
    issuer,
    statusKey: '0x' + certificateStatusKey(issuer, certificate.credential_id).toString('hex'),
    credentialHash: '0x' + credentialHash(jwt).toString('hex'),
    validFrom: payload.nbf,
    validUntil: payload.exp,
  };
  records.push(record, record);
  const vc = payload.vc as {
    id: string;
    issuanceDate: string;
    credentialSubject: Record<string, unknown>;
    credentialStatus: { id: string }[];
    termsOfUse: { id: string }[];
  };
  assert.equal(vc.id, certificate.credential_id);
  assert.ok(Date.parse(vc.issuanceDate) > +certificate.created_at);
  assert.equal(payload.iat, Math.floor(Date.parse(vc.issuanceDate) / 1000));
  assert.equal(
    validatedCredential.issuanceDate,
    vc.issuanceDate,
    'TSR validation must inspect the signed timestamp, not the registration date.',
  );
  assert.equal(vc.credentialSubject.id, subject);
  assert.equal(vc.credentialSubject.certificateNumber, number);
  assert.equal(vc.credentialSubject.name, undefined);
  assert.equal(payload._sd_alg, 'sha-256');
  assert.deepEqual(vc.credentialSubject._sd, [secretDigest(disclosure).toString('base64url')]);
  assert.deepEqual(JSON.parse(Buffer.from(disclosure, 'base64url').toString('utf8')).slice(1), [
    'name',
    'Private name',
  ]);
  // The entry names the registry only; the key follows from the issuer and the id.
  assert.equal(vc.credentialStatus[0].id, `eip155:1337:${contract}`);
  assert.equal(vc.termsOfUse[0].id, `https://tir.example/issuers/${issuer}/attributes/approved`);
  assert.equal(payload.exp, records[1].validUntil);

  let standing = 1n;
  let localRevocation = false;
  let projectedSubject;
  let ledgerHash = records[1].credentialHash;
  let localSuspension = false;
  const verification = credentialVerifier({
    isCertificateSuspended: async (did, id) => {
      assert.equal(did, issuer);
      assert.equal(id, certificate.credential_id);
      return localSuspension;
    },
    isIssuerRevoked: async () => localRevocation,
    validateSchemas: async (credential, schemas) => {
      assert.equal(schemas.length, 2);
      projectedSubject = credential.credentialSubject;
    },
    assertionKey: async (did, kid) => {
      assert.equal(did, issuer);
      assert.equal(kid, issuer + '#current');
      return exportJWK(publicKey);
    },
    checkAccreditation: async (did, type, { reference, schemaId }) => {
      assert.equal(did, issuer);
      assert.equal(type, certificate.credential_type);
      assert.equal(reference, `https://tir.example/issuers/${issuer}/attributes/approved`);
      assert.equal(schemaId, 'https://tsr.example/schemas/professional-license');
    },
    ledger: {
      chainId: 1337,
      contract,
      async status(key) {
        assert.equal(key, records[1].statusKey);
        return {
          standing,
          issuerDid: issuer,
          credentialHash: ledgerHash,
          validFrom: BigInt(records[1].validFrom),
          validUntil: BigInt(records[1].validUntil),
        };
      },
    },
    ledgerStatusSchema: 'https://tsr.example/schemas/ledger-status',
  });
  const token = [jwt, disclosure, ''].join('~');
  assert.deepEqual((await verification(token, { expectedHolder: subject })).claims, {
    certificateNumber: number,
    name: 'Private name',
  });
  assert.deepEqual(projectedSubject, {
    id: subject,
    certificateNumber: number,
    name: 'Private name',
  });
  assert.deepEqual((await verification(jwt)).claims, { certificateNumber: number });
  assert.deepEqual(projectedSubject, { id: subject, certificateNumber: number });
  await assert.rejects(verification(token, { expectedHolder: 'different' }), {
    code: 'InvalidCredentialBinding',
  });
  const future = new Date(payload.exp * 1000);
  const before = new Date(payload.nbf * 1000 - 1);
  await assert.rejects(verification(token, { expectedHolder: subject, now: future }), {
    code: 'Expired',
    outcome: 'EXPIRED',
  });
  await assert.rejects(verification(token, { expectedHolder: subject, now: before }), {
    code: 'NotYetValid',
  });
  const startsLater = Math.floor(Date.now() / 1000) + 3600;
  const notYetJwt = await new SignJWT({
    ...payload,
    nbf: startsLater,
    vc: { ...vc, validFrom: new Date(startsLater * 1000).toISOString() },
  })
    .setProtectedHeader({ alg: 'ES256', kid: issuer + '#current' })
    .sign(privateKey);
  await assert.rejects(
    verification([notYetJwt, disclosure, ''].join('~'), { expectedHolder: subject }),
    { code: 'NotYetValid', outcome: 'NOT_YET_VALID' },
  );
  await assert.rejects(verification(token, { expectedHolder: 'different', now: future }), {
    code: 'InvalidCredentialBinding',
  });
  localRevocation = true;
  await assert.rejects(verification(token), { code: 'AccreditationRevoked', outcome: 'REVOKED' });
  localRevocation = false;
  localSuspension = true;
  await assert.rejects(verification(token), { code: 'Suspended', outcome: 'SUSPENDED' });
  await assert.rejects(verification(token, { expectedHolder: 'different' }), {
    code: 'InvalidCredentialBinding',
  });
  localSuspension = false;
  const forged = Buffer.from(JSON.stringify(['salt', 'name', 'Forged'])).toString('base64url');
  await assert.rejects(verification([jwt, forged, ''].join('~')), { code: 'InvalidDisclosure' });
  await assert.rejects(verification([jwt, disclosure, disclosure, ''].join('~')), {
    code: 'InvalidDisclosure',
  });
  ledgerHash = '0x' + '00'.repeat(32);
  await assert.rejects(verification(token), { code: 'LedgerRecordMismatch' });
  ledgerHash = records[1].credentialHash;
  standing = 2n;
  await assert.rejects(verification(token), { code: 'Suspended' });
  standing = 3n;
  await assert.rejects(verification(token), { code: 'Revoked' });
});
