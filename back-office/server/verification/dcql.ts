import { unverified } from './outcomes.ts';
import { revealDisclosures } from './disclosures.ts';

/** One claim a DCQL credential query names, by its path into the credential. */
interface DcqlClaim {
  id?: string;
  path: (string | number | null)[];
  values?: unknown[];
}

/** One DCQL credential query (OpenID4VP 1.0, section 6.1) as this verifier issues it. */
interface DcqlCredentialQuery {
  id: string;
  format: string;
  multiple?: boolean;
  meta: { type_values: string[][] };
  claims?: DcqlClaim[];
  claim_sets?: string[][];
  require_cryptographic_holder_binding?: boolean;
}

/** A DCQL query (OpenID4VP 1.0): what a verify flow asks the holder for. */
export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
  credential_sets?: unknown;
}

/**
 * Parse the `vp_token` of an OpenID4VP 1.0 response: a JSON object keyed by credential-query id,
 * each value an array of presentations.
 *
 * @param value - Untrusted form value.
 * @returns The object, or undefined for any other shape (a compact JWS among them).
 */
export function parseVpToken(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== 'string' || value.length > 768 * 1024) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (
    !entries.length ||
    entries.some(
      ([id, items]) =>
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        !Array.isArray(items) ||
        !items.length ||
        items.some((item) => typeof item !== 'string' || !item),
    )
  )
    return;
  return parsed as Record<string, string[]>;
}

/**
 * Resolve a claims path pointer (OpenID4VP 1.0, section 7) against a credential.
 * @param root - The credential (its `vc` object for a W3C JWT credential).
 * @param path - Path of names, indexes or null (every element).
 * @returns The values the path selects.
 */
function select(root: unknown, path: DcqlClaim['path']): unknown[] {
  let nodes: unknown[] = [root];
  for (const step of path) {
    const next: unknown[] = [];
    for (const node of nodes) {
      if (step === null && Array.isArray(node)) next.push(...node);
      else if (typeof step === 'number' && Array.isArray(node) && step in node)
        next.push(node[step]);
      else if (typeof step === 'string' && node && typeof node === 'object' && !Array.isArray(node))
        if (Object.hasOwn(node, step)) next.push((node as Record<string, unknown>)[step]);
    }
    nodes = next;
  }
  return nodes;
}

/**
 * The claim names a credential discloses beyond what it shows in clear.
 * @param credential - Credential with its `~` disclosures.
 * @returns The disclosed names.
 */
function disclosedNames(credential: string) {
  return credential
    .trim()
    .split('~')
    .slice(1)
    .filter(Boolean)
    .map((disclosure) => {
      try {
        return String(JSON.parse(Buffer.from(disclosure, 'base64url').toString('utf8'))[1]);
      } catch {
        return '';
      }
    });
}

/**
 * Check an OpenID4VP 1.0 VP Token against the DCQL query it answers.
 *
 * @param vpToken - Parsed VP Token.
 * @param query - The verify flow's query.
 * @param algorithms - Accepted JWS algorithms for presentations and credentials.
 * @returns The presentations, in query order, or undefined when the token does not answer the
 * query exactly: an unrequested or missing credential query, a credential of another type or
 * format, claims matching no claim set, or a disclosure the query did not ask for.
 * @remarks Signatures and holder binding are checked separately; this checks shape and data
 * minimisation. JSONPath is not evaluated: paths are DCQL claims path pointers.
 */
export function matchesDcql(
  vpToken: Record<string, string[]>,
  query: DcqlQuery | null,
  algorithms: string[] = ['ES256'],
) {
  if (
    !query ||
    !Array.isArray(query.credentials) ||
    !query.credentials.length ||
    query.credential_sets
  )
    return;
  const ids = query.credentials.map((item) => item.id);
  if (
    Object.keys(vpToken).length !== ids.length ||
    Object.keys(vpToken).some((id) => !ids.includes(id))
  )
    return;
  const presentations: string[] = [];
  try {
    for (const credentialQuery of query.credentials) {
      const answers = vpToken[credentialQuery.id];
      if (!answers || (!credentialQuery.multiple && answers.length !== 1)) return;
      if (credentialQuery.format !== 'jwt_vc_json') return;
      for (const presentation of answers) {
        const vp = unverified(presentation);
        if (!algorithms.includes(vp.header.alg)) return;
        const credentials = vp.payload.vp?.verifiableCredential;
        if (
          !Array.isArray(credentials) ||
          credentials.length !== 1 ||
          typeof credentials[0] !== 'string'
        )
          return;
        const credential: string = credentials[0];
        const signed = unverified(credential.split('~')[0]);
        if (!algorithms.includes(signed.header.alg)) return;
        const vc = revealDisclosures(credential, signed.payload).vc;
        const types: unknown[] = Array.isArray(vc?.type) ? vc.type : [];
        if (
          !credentialQuery.meta.type_values.some((set) => set.every((type) => types.includes(type)))
        )
          return;
        const claims = credentialQuery.claims ?? [];
        const present = new Set(
          claims
            .filter((claim) => {
              const values = select(vc, claim.path);
              return claim.values
                ? values.some((value) => claim.values!.includes(value))
                : values.length > 0;
            })
            .map((claim) => claim.id ?? claim.path.join('.')),
        );
        const satisfied = credentialQuery.claim_sets
          ? credentialQuery.claim_sets.some((set) => set.every((id) => present.has(id)))
          : claims.every((claim) => present.has(claim.id ?? claim.path.join('.')));
        if (!satisfied) return;
        // Nothing beyond what was asked: without claims, only what the credential shows in clear.
        const requested = new Set(
          claims
            .filter((claim) => claim.path.length === 2 && claim.path[0] === 'credentialSubject')
            .map((claim) => String(claim.path[1])),
        );
        if (disclosedNames(credential).some((name) => !requested.has(name))) return;
        presentations.push(presentation);
      }
    }
  } catch {
    return;
  }
  return presentations;
}
