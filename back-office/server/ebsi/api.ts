import type { EbsiScope } from './authorisation.ts';

/**
 * Which shape of EBSI's APIs the back-office talks to (`PLR_EBSI_API`):
 * - `pilot`: what EBSI's pilot network serves today: Authorisation API v4 (presentation
 *   definitions), DID Registry v5, Trusted Issuers Registry v5, Trusted Schemas Registry v3, and
 *   the Ledger API v4; registry writes go through each registry's JSON-RPC
 *   `sendSignedTransaction`;
 * - `core-v1`: the Core API v1 its documentation describes: `/v1/auth` (DCQL), `/v1/*-registry`,
 *   and every write through `/v1/ledger`.
 */
export type EbsiApiVersion = 'pilot' | 'core-v1';

/**
 * Read `PLR_EBSI_API`.
 * @param value - The variable's value.
 * @returns The API shape; `pilot` when unset.
 * @throws Error for an unknown shape.
 */
export function ebsiApiVersion(value: string | undefined): EbsiApiVersion {
  const version = value?.trim() || 'pilot';
  if (version !== 'pilot' && version !== 'core-v1')
    throw new Error('PLR_EBSI_API must be pilot or core-v1.');
  return version;
}

/** The pilot's scope names for the back-office's scopes. */
const pilotScopes: Record<EbsiScope, string> = {
  'did-registry:invite': 'didr_invite',
  'did-registry:write': 'didr_write',
  'issuers-registry:invite': 'tir_invite',
  'issuers-registry:write': 'tir_write',
  'timestamp:write': 'timestamp_write',
  'ledger:invoke': 'ledger_invoke',
};

/**
 * EBSI's DID Registry and Trusted Issuers Registry on the pilot network. The pilot's APIs do not
 * name them, and registry transactions are addressed to them; checked on the pilot's ledger
 * (the issuers registry names this DID Registry as its own).
 */
export const pilotRegistryContracts = {
  didRegistry: '0x76C8190D7422e5fa2A0190Bc2313bab0b2afEC78',
  issuersRegistry: '0x5C87455c82617579A10AD39C2DB3e60E846E7266',
} as const;

/**
 * Where each of EBSI's APIs is, in a given shape, below one origin.
 * @param origin - EBSI's API origin (`https://api-pilot.ebsi.eu`, or the development service).
 * @param version - The API shape.
 * @returns The bases of each API and the scope names the shape uses.
 */
export function ebsiApi(origin: string, version: EbsiApiVersion) {
  const root = origin.replace(/\/+$/, '');
  const pilot = version === 'pilot';
  return {
    version,
    authorisation: root + (pilot ? '/authorisation/v4' : '/v1/auth'),
    didRegistry: root + (pilot ? '/did-registry/v5' : '/v1/did-registry'),
    issuersRegistry: root + (pilot ? '/trusted-issuers-registry/v5' : '/v1/issuers-registry'),
    schemasRegistry: root + (pilot ? '/trusted-schemas-registry/v3' : '/v1/schemas-registry'),
    ledger: root + (pilot ? '/ledger/v4/blockchains/besu' : '/v1/ledger'),
    /**
     * The shape's name for a scope.
     * @param scope - The back-office's scope.
     * @returns `didr_invite`… on the pilot, the scope itself in Core API v1.
     */
    scope(scope: EbsiScope) {
      return pilot ? pilotScopes[scope] : scope;
    },
  };
}

/** EBSI's APIs in one shape below one origin ({@link ebsiApi}). */
export type EbsiApi = ReturnType<typeof ebsiApi>;

/**
 * The settings that point the back-office at EBSI's APIs of one shape below one origin, as the
 * deployment's configuration names them; tests and development compose them the same way.
 * @param origin - EBSI's API origin.
 * @param version - The API shape.
 * @returns `PLR_EBSI_URL`, `PLR_EBSI_API`, the registry bases and the Ledger API.
 */
export function ebsiEnvironment(origin: string, version: EbsiApiVersion) {
  const api = ebsiApi(origin, version);
  return {
    PLR_EBSI_URL: origin.replace(/\/+$/, ''),
    PLR_EBSI_API: version,
    PLR_TIR_URL: api.issuersRegistry,
    PLR_DIDR_URL: api.didRegistry + '/identifiers',
    PLR_TSR_URL: api.schemasRegistry,
    PLR_LEDGER_RPC_URL: api.ledger,
  };
}

/** Where a Trusted Issuers Registry's paths start, in either shape. */
const issuersRegistryMarkers = ['/trusted-issuers-registry/v5/', '/v1/issuers-registry/'];

/**
 * A link into a Trusted Issuers Registry, in whichever shape it was written (an accreditation
 * names its parent, a licence its issuer's attribute), moved onto the configured registry when it
 * is at the same origin. A link anywhere else is returned as it is, for the caller to refuse.
 * @param value - The link.
 * @param base - The configured registry base (`PLR_TIR_URL`).
 * @returns The link below the configured base, or the value unchanged.
 */
export function onIssuersRegistry(value: string, base: string) {
  try {
    const url = new URL(value);
    const root = new URL(base.replace(/\/+$/, '') + '/');
    if (url.origin !== root.origin) return value;
    for (const marker of issuersRegistryMarkers) {
      const at = url.pathname.indexOf(marker);
      if (at !== -1) return root.href + url.pathname.slice(at + marker.length) + url.search;
    }
  } catch {
    // Not a URL: the caller refuses it.
  }
  return value;
}
