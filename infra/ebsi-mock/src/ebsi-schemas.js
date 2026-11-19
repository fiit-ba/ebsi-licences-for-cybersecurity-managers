/**
 * EBSI's own schemas on its pilot network: the trust chain's credentials name them. The
 * back-office registers copies in this service's Trusted Schemas Registry under the same ids.
 */
export const EBSI_SCHEMAS = {
  accreditation: 'zHXHLkJpZg4w9nt2GbEBbyE8uhkfirbmT3nF7mJ9kFnjv',
  authorisation: 'zBE5cU4EGs5AABdrPRfMfGSZ63oMi6yet5gYTEKYmstAa',
  issuanceCertificate: 'z2yw1Mq2Cq4jN8B2bJ66cGcFEqjrJQUinxHAUjZTkVKjz',
};

/**
 * The credentialSchema of a trust-chain credential: an accreditation names EBSI's accreditation
 * schema, and the IssuanceCertificate extension when it has terms of use; anything else EBSI's
 * authorisation schema.
 * @param {string} base This service's base URL.
 * @param {string[]} types The credential's types.
 * @param {boolean} [termsOfUse] Whether it has an IssuanceCertificate termsOfUse.
 * @returns {{id: string, type: string}[]} The entries.
 */
export function trustChainSchemas(base, types, termsOfUse = false) {
  const address = (id) => ({id: `${base}/v1/schemas-registry/schemas/${id}`, type: 'FullJsonSchemaValidator2021'});
  if (types.some((type) => type.startsWith('VerifiableAccreditation')))
    return [address(EBSI_SCHEMAS.accreditation), ...(termsOfUse ? [address(EBSI_SCHEMAS.issuanceCertificate)] : [])];
  return [address(EBSI_SCHEMAS.authorisation)];
}
