/**
 * What EBSI's Support Office does outside the Core API, as the development registries offer it.
 *
 * On EBSI these are processes with people in them: onboarding a RootTAO, registering a schema
 * proposal, granting access to a deployed contract. The development registries answer each with
 * one request under `/__mock/`. No such endpoint exists on EBSI, so outside development these
 * steps stay manual and this client is not configured.
 */
export interface DevelopmentSupportOffice {
  /** Fund a development ledger key with gas; EBSI itself charges none. */
  fund(address: string): Promise<void>;
  /** A VerifiableAuthorisationToOnboard for a RootTAO's DID. */
  onboarding(did: string): Promise<string>;
  /** A RootTAO's attribute in the TIR and the VerifiableAuthorisationForTrustChain it stores there. */
  rootTao(did: string): Promise<{ attributeId: string; credential: string }>;
  /** A VerifiableAuthorisationToInvoke for the Trusted Contracts (the certificate registry and its governance). */
  invoke(did: string): Promise<string>;
  /** Register or update a schema in the TSR. */
  registerSchema(schemaId: string, schema: Record<string, unknown>): Promise<void>;
}

/**
 * Connect to the development registries' Support Office endpoints.
 *
 * @param mockUrl - Explicitly configured development registry origin.
 * @param request - HTTP transport, replaceable in isolated tests.
 * @returns The Support Office operations, or undefined when no development registry is configured.
 * @throws Error for an invalid URL.
 */
export function developmentSupportOffice(
  mockUrl: string | undefined,
  request: typeof fetch = fetch,
): DevelopmentSupportOffice | undefined {
  if (!mockUrl) return undefined;
  const base = new URL(mockUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Configure a plain HTTP(S) development registry origin.');
  const origin = base.href.replace(/\/+$/, '');

  /**
   * Call one Support Office endpoint.
   * @param path - Endpoint path.
   * @param body - JSON body.
   * @returns The JSON answer.
   * @throws Error for an unavailable or refusing registry.
   */
  async function call(path: string, body: Record<string, unknown>) {
    const response = await request(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    });
    const value = await response.json().catch(() => undefined);
    if (!response.ok || !value || typeof value !== 'object')
      throw new Error(
        `The development Support Office refused ${path}: ${value?.detail ?? response.status}`,
      );
    return value as Record<string, unknown>;
  }

  const credential = (value: Record<string, unknown>) => {
    if (typeof value.credential !== 'string')
      throw new Error('The Support Office issued no credential.');
    return value.credential;
  };

  return {
    /**
     * Give a development key gas.
     * @param address - The key's address.
     * @returns Completion once funded.
     */
    async fund(address) {
      await call('/__mock/fund', { address });
    },
    /**
     * The Support Office's VerifiableAuthorisationToOnboard for a DID.
     * @param did - The DID to be registered.
     * @returns The credential.
     */
    async onboarding(did) {
      return credential(await call('/__mock/support-office/onboard', { did }));
    },
    /**
     * Accredit a RootTAO: its attribute in the Trusted Issuers Registry, and its authorisation.
     * @param did - The RootTAO's DID.
     * @returns The attribute id and the VerifiableAuthorisationForTrustChain.
     */
    async rootTao(did) {
      const value = await call('/__mock/support-office/root-tao', { did });
      if (typeof value.attributeId !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.attributeId))
        throw new Error('The Support Office acknowledged no RootTAO attribute.');
      return { attributeId: value.attributeId, credential: credential(value) };
    },
    /**
     * The Support Office's VerifiableAuthorisationToInvoke the Trusted Contracts.
     * @param did - The organization's DID.
     * @returns The credential.
     */
    async invoke(did) {
      return credential(await call('/__mock/support-office/invoke', { did }));
    },
    /**
     * Register a schema in the Trusted Schemas Registry, as the Support Office does.
     * @param schemaId - The schema's id.
     * @param schema - The JSON schema.
     * @returns Completion once registered.
     */
    async registerSchema(schemaId, schema) {
      await call('/__mock/support-office/schemas', { schemaId, schema });
    },
  };
}
