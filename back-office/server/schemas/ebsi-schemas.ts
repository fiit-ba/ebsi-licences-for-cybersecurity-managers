import { readFileSync } from 'node:fs';

/**
 * EBSI's own schemas in its Trusted Schemas Registry, as they are on the pilot network: the
 * base every credential extends, and the trust chain's. The registry derives a schema's id from
 * its content, so the same schema has the same id wherever it is registered; the development
 * registry holds copies (`/schemas/ebsi/`) under these ids.
 */
export const ebsiSchemaIds = {
  /** EBSI Verifiable Attestation (VCDM 1.1), which every credential extends. */
  attestation: 'zH74MKkYTbQ6ZfTxufi6A3Aw8giS4piGm8dpgxFmkJjmu',
  /** The same schema as EBSI's other schemas refer to it: the hash in hex. */
  attestationHex: '0xef484394a9c6622016a2e2e4eba7e093d96433474938fa2a70935697a139c5ec',
  /** EBSI Verifiable Accreditation Record: VerifiableAccreditationToAccredit and ToAttest. */
  accreditation: 'zHXHLkJpZg4w9nt2GbEBbyE8uhkfirbmT3nF7mJ9kFnjv',
  /** EBSI Verifiable Authorisation: VerifiableAuthorisationToOnboard and ForTrustChain. */
  authorisation: 'zBE5cU4EGs5AABdrPRfMfGSZ63oMi6yet5gYTEKYmstAa',
  /** EBSI's type extension for a `termsOfUse` of type IssuanceCertificate. */
  issuanceCertificate: 'z2yw1Mq2Cq4jN8B2bJ66cGcFEqjrJQUinxHAUjZTkVKjz',
} as const;

/** The registry's JSON Schemas, copied from `/schemas` (scripts/sync-schemas.ts). */
export const registrySchemaFiles = JSON.parse(
  readFileSync(new URL('../../shared/schemas.json', import.meta.url), 'utf8'),
) as {
  cybersecurityManagerCertificate: Record<string, unknown>;
  certificateStatusEntry: Record<string, unknown>;
  ebsi: Record<string, Record<string, unknown>>;
};

/**
 * The copies of EBSI's schemas the development registry holds, by the ids it holds them under:
 * each by its id, the Verifiable Attestation also by its hex id, as EBSI's schemas refer to it.
 * @returns The documents to register, by id.
 * @throws Error when a copy is missing.
 */
export function ebsiSchemaCopies() {
  const read = (id: string) => {
    const document = registrySchemaFiles.ebsi[id];
    if (!document) throw new Error(`No copy of EBSI's schema ${id} in /schemas/ebsi.`);
    return document;
  };
  return [
    ...[
      ebsiSchemaIds.attestation,
      ebsiSchemaIds.accreditation,
      ebsiSchemaIds.authorisation,
      ebsiSchemaIds.issuanceCertificate,
    ].map((id) => ({ id, document: read(id) })),
    { id: ebsiSchemaIds.attestationHex, document: read(ebsiSchemaIds.attestation) },
  ];
}

/**
 * The id of a schema a reference names when it points into a Trusted Schemas Registry (EBSI's,
 * the pilot's or the development one): the last segment of `…/schemas/<id>`.
 * @param reference - A `$ref` or credentialSchema id.
 * @returns The schema id, or undefined for another kind of reference.
 */
export function registrySchemaId(reference: string) {
  const match = /^https?:\/\/[^#?]+\/schemas\/([A-Za-z0-9._-]{1,200})$/.exec(reference);
  return match && !['.', '..'].includes(match[1]) ? match[1] : undefined;
}
