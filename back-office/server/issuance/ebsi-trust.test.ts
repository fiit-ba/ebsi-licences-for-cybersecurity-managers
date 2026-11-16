import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ebsiIssuerTrust } from './ebsi-trust.ts';

test('issuance requires an in-force, signed EBSI chain for the exact schema version', async () => {
  const tir = 'https://example.test/tir/v5';
  const didRegistry = 'https://example.test/didr/v5/identifiers';
  const [ti, tao, root, anchor] = [
    'did:ebsi:zTi',
    'did:ebsi:zTao',
    'did:ebsi:zRoot',
    'did:ebsi:zAnchor',
  ];
  const schemaId = 'https://example.test/tsr/v3/schemas/ProfessionalLicenseV1';
  const types = ['VerifiableCredential', 'VerifiableAttestation', 'ProfessionalLicense'];
  const records = new Map();
  const signers = new Map();
  for (const did of [tao, root, anchor]) {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const kid = did + '#assertion';
    signers.set(did, { privateKey, kid });
    records.set(didRegistry + '/' + did, {
      id: did,
      assertionMethod: [kid],
      verificationMethod: [
        {
          id: kid,
          type: 'JsonWebKey2020',
          controller: did,
          publicKeyJwk: await exportJWK(publicKey),
        },
      ],
    });
  }
  const trust = ebsiIssuerTrust({
    tirUrl: tir,
    didRegistryUrl: didRegistry,
    trustedRoots: [anchor],
    async fetchRegistry(url) {
      assert.ok(url.startsWith('https://example.test/'));
      return records.has(url)
        ? Response.json(records.get(url))
        : new Response(null, { status: 404 });
    },
  });
  const attribute = (did) => trust.accreditationAddress(did, 'accreditation');
  async function put(subject, signer, role, parent?: string, overrides = {}) {
    const { kid, privateKey } = signers.get(signer);
    const body = await new SignJWT({
      vc: {
        issuer: signer,
        type: ['VerifiableCredential', role],
        credentialSubject: { id: subject, accreditedFor: [{ schemaId, types }] },
        termsOfUse: parent ? [{ id: attribute(parent) }] : [],
        ...overrides,
      },
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(signer)
      .setSubject(subject)
      .sign(privateKey);
    records.set(attribute(subject), { did: subject, attribute: { body, issuerType: 'active' } });
  }
  await put(ti, tao, 'VerifiableAccreditationToAttest', tao);
  await put(tao, root, 'VerifiableAccreditationToAccredit', root);
  await put(root, anchor, 'VerifiableAuthorisationForTrustChain');
  const check = (id = schemaId) =>
    trust.ensureAccredited(ti, 'ProfessionalLicense', { attribute: 'accreditation', schemaId: id });
  await check();
  await assert.rejects(check(schemaId + '-different'), /does not cover/);

  const parent = records.get(attribute(tao));
  parent.attribute.issuerType = 'Revoked';
  await assert.rejects(check(), /missing or revoked/);
  parent.attribute.issuerType = 'active';

  const document = records.get(didRegistry + '/' + root);
  const methods = document.assertionMethod;
  document.assertionMethod = [];
  await assert.rejects(check(), /authorize this assertion key/);
  document.assertionMethod = methods;

  await put(ti, tao, 'VerifiableAccreditationToAttest', tao, {
    termsOfUse: { id: 'https://other.test/attribute' },
  });
  await assert.rejects(check(), /does not identify its parent/);
  await put(ti, tao, 'VerifiableAccreditationToAttest', tao, {
    expirationDate: '2020-01-01T00:00:00Z',
  });
  await assert.rejects(check(), /outside its validity/);
});
