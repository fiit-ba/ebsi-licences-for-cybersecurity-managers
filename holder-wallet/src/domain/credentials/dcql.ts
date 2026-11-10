// What a verifier asks for with OpenID4VP 1.0, a DCQL query (section 6), matched
// against the certificates the wallet holds. A credential query names the
// format and types it accepts and, by claims path pointers into the credential,
// the claims it wants; its claim sets are the combinations it accepts, the one
// it prefers first. The holder picks one of those the certificate can satisfy,
// and the wallet discloses exactly the attributes of that set: those shown in
// clear (the TI, number, validity, schemas, registry) need no disclosure.
import { claimsOf, optionalAttributes } from './sdJwt'

export type DcqlClaim = { id?: string; path: Array<string | number | null>; values?: unknown[] }

export type DcqlCredentialQuery = {
  id: string
  format: string
  multiple?: boolean
  meta?: { type_values?: string[][] }
  claims?: DcqlClaim[]
  claim_sets?: string[][]
  require_cryptographic_holder_binding?: boolean
}

export type DcqlQuery = { credentials: DcqlCredentialQuery[]; credential_sets?: unknown[] }

/** The format of the registry's certificates: W3C VCs signed as JWTs. */
export const CERTIFICATE_FORMAT = 'jwt_vc_json'

/** The values a claims path pointer (OpenID4VP 1.0, section 7) selects in `root`. */
export const select = (root: unknown, path: DcqlClaim['path']): unknown[] => {
  let nodes: unknown[] = [root]
  for (const step of path) {
    const next: unknown[] = []
    for (const node of nodes) {
      if (step === null && Array.isArray(node)) next.push(...node)
      else if (typeof step === 'number' && Array.isArray(node) && step >= 0 && step < node.length) next.push(node[step])
      else if (typeof step === 'string' && node && typeof node === 'object' && !Array.isArray(node)) {
        if (Object.prototype.hasOwnProperty.call(node, step)) next.push((node as Record<string, unknown>)[step])
      }
    }
    nodes = next
  }
  return nodes
}

const claimId = (claim: DcqlClaim): string => claim.id ?? claim.path.map(String).join('.')

/** One combination of claims the holder may present: the claim ids, and the attributes to disclose for them. */
export type ClaimOption = { ids: string[]; names: string[] }

/**
 * The combinations of the query's claims this certificate can present, in the
 * verifier's order of preference; empty when it does not answer the query at all.
 */
export const claimOptions = (query: DcqlCredentialQuery, token: string): ClaimOption[] => {
  if (query.format !== CERTIFICATE_FORMAT) return []
  let vc: Record<string, unknown>
  let disclosable: string[]
  try {
    vc = claimsOf(token).vc
    disclosable = optionalAttributes(token)
  } catch {
    return []
  }
  const types = ([] as unknown[]).concat(vc?.type ?? [])
  const typeSets = query.meta?.type_values ?? []
  if (typeSets.length && !typeSets.some((set) => set.every((type) => types.includes(type)))) return []
  const claims = query.claims ?? []
  const present = new Set(
    claims
      .filter((claim) => {
        const values = select(vc, claim.path)
        return claim.values ? values.some((value) => claim.values!.includes(value)) : values.length > 0
      })
      .map(claimId),
  )
  const sets = query.claim_sets?.length ? query.claim_sets : [claims.map(claimId)]
  return sets
    .filter((set) => set.every((id) => present.has(id)))
    .map((ids) => ({
      ids,
      names: claims
        .filter((claim) => ids.includes(claimId(claim)))
        .filter((claim) => claim.path.length === 2 && claim.path[0] === 'credentialSubject')
        .map((claim) => String(claim.path[1]))
        .filter((name) => disclosable.includes(name)),
    }))
}

/** Whether the certificate answers the credential query with at least one combination of claims. */
export const answers = (query: DcqlCredentialQuery, token: string): boolean => claimOptions(query, token).length > 0

/**
 * Assign each chosen certificate to the first unanswered credential query it
 * answers. Undefined when they do not answer every query exactly once.
 */
export const assignQueries = (
  queries: DcqlCredentialQuery[],
  tokens: { id: string; token: string }[],
): Record<string, string> | undefined => {
  const assigned: Record<string, string> = {}
  for (const { id, token } of tokens) {
    const query = queries.find((candidate) => !(candidate.id in assigned) && answers(candidate, token))
    if (!query) return undefined
    assigned[query.id] = id
  }
  return Object.keys(assigned).length === queries.length ? assigned : undefined
}
