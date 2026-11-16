// The verifier's own checks of a presented certificate (design decisions D33,
// D34, D36), made with EBSI's registries and the ledger, never the back-office:
//   presentation  the JWT-VP is signed by the holder's did:key, for this
//                 exchange's challenge and this verifier's domain, just made
//   holder        the certificate is bound to that DID (credentialSubject.id)
//   signature     the issuer's key from the DID Registry, as it stood when
//                 the certificate was issued, verifies the certificate
//   disclosures   every attribute the holder disclosed matches a digest the
//                 issuer signed (SD-JWT inside the JWT-VC); the rest stays
//                 hidden
//   issuer        the Trusted Issuers Registry accredits the issuer, through
//                 its TAO, up to a RootTAO the Support Office authorised, and
//                 nothing on the way is revoked
//   schema        the Trusted Schemas Registry's schemas accept it
//   status        the certificate registry's record, through the Ledger API,
//                 found by the TI and the certificate's id - the only source
//                 of truth about the certificate: its own (TI, hash of this
//                 credential, dates), and valid, or not (suspended and
//                 revoked alike)
//   time          it is in force now
// URLs the certificate names are followed only within the registries this
// wallet is configured with: the holder hands over the certificate, and a
// URL in it could lead anywhere.
import { Validator } from 'jsonschema'
import { certificates, ebsi, supportOfficeDid } from '@infrastructure/config/Ebsi'
import { ledgerEntryOf, readCertificateStatus, recordDiffers, statusKeyOfCredential } from '@infrastructure/ledger'
import { reveal, split } from '@domain/credentials/sdJwt'
import { fetchWithin } from '@infrastructure/network/http'
import { PublicJwk, didKeyJwk, verifyEs256 } from './es256'
import { FieldSelection, Presentation, presentedJwtOf } from './protocol'
import type { CredentialEvidence, VerificationResult } from '@infrastructure/verifier/verifier.types'
import { base64url } from 'jose'

// Each read from EBSI's registries; generous, for a phone on a slow connection.
const FETCH_TIMEOUT_MS = 30000
const PRESENTATION_MAX_AGE_SECONDS = 300
const CLOCK_SKEW_SECONDS = 60
const MAX_CHAIN = 5

type Check = boolean | null

export type Checks = {
  presentation_valid: Check
  signature_valid: Check
  issuer_key_valid: Check
  disclosures_valid: Check
  issuer_accredited: Check
  schemas_valid: Check
  time_valid: Check
  holder_bound: Check
  status_available: Check
  record_matches: Check
  standing_valid: Check
}

const getJson = (url: string) =>
  fetchWithin(url, { headers: { Accept: 'application/json' } }, FETCH_TIMEOUT_MS, (response) => {
    if (!response.ok) throw new Error(`${response.status} from ${url}`)
    return response.json()
  })

/** A registry URL the certificate names, moved onto the configured registry - or an error. */
export const rebase = (url: string, base: string, marker: string): string => {
  const at = String(url ?? '').indexOf(marker)
  if (at === -1) throw new Error(`Not a ${marker} URL: ${url}`)
  return `${base}/${String(url)
    .slice(at + marker.length)
    .replace(/^\/+/, '')}`
}

const decodePayload = (jwt: string) =>
  JSON.parse(Buffer.from(base64url.decode(String(jwt).split('.')[1])).toString('utf8'))
const decodeHeader = (jwt: string) =>
  JSON.parse(Buffer.from(base64url.decode(String(jwt).split('.')[0])).toString('utf8'))

/** The P-256 key a DID document lists under `kid`, as it stood at `at`. */
const issuerKey = async (did: string, kid: string, at?: string): Promise<PublicJwk | null> => {
  const query = at ? `?valid-at=${encodeURIComponent(at)}` : ''
  const document = await getJson(`${ebsi.didRegistry()}/identifiers/${encodeURIComponent(did)}${query}`)
  const wanted = kid.startsWith(did) ? kid : `${did}#${kid.replace(/^#/, '')}`
  const method = (document?.verificationMethod ?? []).find((m: any) => m?.id === wanted)
  const asserts = (document?.assertionMethod ?? []).some(
    (ref: any) => (typeof ref === 'string' ? ref : ref?.id) === wanted,
  )
  if (!method?.publicKeyJwk || !asserts) return null
  return method.publicKeyJwk
}

const asList = (value: any): any[] => (Array.isArray(value) ? value : value ? [value] : [])

type ChainLink = { did: string; role: string }

/** What a DID is, by the accreditation it holds (component 3.2). */
const CHAIN_ROLES: Record<string, string> = {
  VerifiableAccreditationToAttest: 'TI',
  VerifiableAccreditationToAccredit: 'TAO',
  VerifiableAuthorisationForTrustChain: 'RootTAO',
}
const ROOT_TYPE = 'VerifiableAuthorisationForTrustChain'
const TIR_MARKER = '/v1/issuers-registry/'

type TirRecord = { did: string; attribute: { body: string; issuerType?: string } }

/** Every attribute the TIR holds for a DID (a link to the collection, component 3.3). */
const attributesOf = async (did: string): Promise<TirRecord[]> => {
  const tir = ebsi.trustedIssuersRegistry()
  const issuer = await getJson(`${tir}/issuers/${encodeURIComponent(did)}`)
  if (typeof issuer?.attributes !== 'string') throw new Error(`${did} is not in the TIR`)
  const listing = await getJson(rebase(issuer.attributes, tir, TIR_MARKER))
  return Promise.all(
    asList(listing?.items)
      .filter((item: any) => typeof item?.href === 'string')
      .map((item: any) => getJson(rebase(item.href, tir, TIR_MARKER))),
  )
}

const attributeAt = async (url: string): Promise<TirRecord> =>
  getJson(rebase(url, ebsi.trustedIssuersRegistry(), TIR_MARKER))

/** An accreditation's VC and issuer, once its signature verifies with its issuer's DIDR key. */
const verifiedAccreditation = async (token: string, now: number) => {
  const header = decodeHeader(token)
  const payload = decodePayload(token)
  const vc = payload?.vc
  const issuer = String(payload?.iss ?? vc?.issuer ?? '')
  if (!vc || !issuer || !header?.kid) return null
  const key = await issuerKey(issuer, String(header.kid)).catch(() => null)
  if (!key || !verifyEs256(token, key)) return null
  const seconds = now / 1000
  const from = payload.nbf ?? (vc.validFrom ? Date.parse(vc.validFrom) / 1000 : undefined)
  const until = payload.exp ?? (vc.validUntil ? Date.parse(vc.validUntil) / 1000 : undefined)
  if ((from && from > seconds + 300) || (until && until <= seconds)) return null
  return { vc, issuer }
}

/**
 * Walk the trust chain from the issuer up (component 3.1), as the
 * back-office's verifier does (back-office/server/verification/credential.ts): at each level an
 * accreditation of the expected kind in the TIR, signed by the DID above, for
 * this one, in force, covering the certificate's schema and type - up to a
 * RootTAO the Support Office authorised. An attribute marked revoked anywhere
 * on the way ends it.
 */
export const walkTrustChain = async (
  issuer: string,
  termsOfUse: any,
  schemaIds: string[],
  types: string[],
  now = Date.now(),
): Promise<{ ok: boolean; chain: ChainLink[]; reason?: string }> => {
  const chain: ChainLink[] = []
  const specific = types.filter((type) => !['VerifiableCredential', 'VerifiableAttestation'].includes(type))
  const covers = (vc: any) =>
    asList(vc?.credentialSubject?.accreditedFor).some(
      (scope: any) =>
        schemaIds.includes(scope?.schemaId) && specific.every((type) => asList(scope?.types).includes(type)),
    )
  // The certificate's terms of use name the TI's accreditation; without
  // them, or when the TIR does not have that attribute, its attributes are
  // found by its DID.
  const term = asList(termsOfUse).find((entry) => entry?.id)
  let candidates: TirRecord[] = term
    ? await attributeAt(term.id).then(
        (record) => [record],
        () => attributesOf(issuer),
      )
    : await attributesOf(issuer)
  let subject = issuer
  let expected = 'VerifiableAccreditationToAttest'
  const visited = new Set<string>()
  for (let depth = 0; depth < MAX_CHAIN; depth++) {
    if (visited.has(subject)) break
    visited.add(subject)
    if (candidates.some((record) => String(record?.attribute?.issuerType ?? '').toLowerCase() === 'revoked')) {
      chain.push({ did: subject, role: 'Revoked' })
      return { ok: false, chain, reason: 'revoked' }
    }
    let chosen: { vc: any; issuer: string } | null = null
    for (const record of candidates) {
      if (record?.did !== subject || !record?.attribute?.body) continue
      const accreditation = await verifiedAccreditation(record.attribute.body, now)
      if (!accreditation || !asList(accreditation.vc.type).includes(expected)) continue
      if (accreditation.vc?.credentialSubject?.id !== subject) continue
      if (expected !== ROOT_TYPE && !covers(accreditation.vc)) continue
      chosen = accreditation
      break
    }
    if (!chosen) return { ok: false, chain, reason: `${subject} holds no ${expected} for this certificate` }
    chain.push({ did: subject, role: CHAIN_ROLES[expected] })
    if (expected === ROOT_TYPE) {
      const trusted = Boolean(supportOfficeDid()) && chosen.issuer === supportOfficeDid()
      return trusted
        ? { ok: true, chain }
        : { ok: false, chain, reason: 'The RootTAO is not authorised by the Support Office' }
    }
    // Up one level: the parent's own accreditation, by its terms of use or its attributes.
    const parent = chosen.issuer
    const parentTerm = asList(chosen.vc.termsOfUse).find((entry) => entry?.id)
    candidates = parentTerm ? [await attributeAt(parentTerm.id)] : await attributesOf(parent)
    const parentTypes = candidates.flatMap((record) => {
      try {
        return asList(decodePayload(record.attribute.body)?.vc?.type)
      } catch {
        return []
      }
    })
    subject = parent
    expected = parentTypes.includes(ROOT_TYPE) ? ROOT_TYPE : 'VerifiableAccreditationToAccredit'
  }
  return { ok: false, chain, reason: 'The chain does not end at a trusted root' }
}

const validateSchemas = async (schemaIds: string[], credential: object): Promise<boolean> => {
  if (schemaIds.length === 0) return false
  const validator = new Validator()
  for (const id of schemaIds) {
    const schema = await getJson(rebase(id, ebsi.trustedSchemasRegistry(), '/v1/schemas-registry/'))
    const { $schema: _draft, ...rules } = schema ?? {}
    if (!validator.validate(credential, rules).valid) return false
  }
  return true
}

const iso = (seconds?: number) => (seconds ? new Date(seconds * 1000).toISOString() : null)

const secondsOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time / 1000 : undefined
}

export type OfflineVerification = VerificationResult & { missingFields: string[] }

/**
 * Verify what a holder presented over an exchange, for the challenge and
 * domain this verifier sent, and say it the way the console's verifier does.
 */
export const verifyPresentation = async (
  presentation: Presentation,
  {
    challenge,
    domain,
    fields,
    now = Date.now(),
  }: { challenge: string; domain: string; fields: FieldSelection; now?: number },
): Promise<OfflineVerification> => {
  const checks: Checks = {
    presentation_valid: null,
    signature_valid: null,
    issuer_key_valid: null,
    disclosures_valid: null,
    issuer_accredited: null,
    schemas_valid: null,
    time_valid: null,
    holder_bound: null,
    status_available: null,
    record_matches: null,
    standing_valid: null,
  }
  const evidence: CredentialEvidence = { state: 'INDETERMINATE', checks: checks as any }
  const result = (outcome: string, types: string[] = [], missingFields: string[] = []): OfflineVerification => {
    evidence.state = outcome
    return {
      status: 'done',
      outcome,
      verified: outcome === 'VALID',
      credential_types: types,
      checks: checks as any,
      credentials: [evidence],
      attributes_until: null,
      created_at: new Date(now).toISOString(),
      missingFields,
    }
  }

  // One certificate, a JWT-VC, in a JWT-VP - with the disclosures the holder
  // chose after it (D36).
  let vpJwt: string
  let vpHeader: any
  let vpPayload: any
  let credentialJwt: string
  let disclosures: string[]
  let header: any
  let payload: any
  try {
    vpJwt = presentedJwtOf(presentation)
    vpHeader = decodeHeader(vpJwt)
    vpPayload = decodePayload(vpJwt)
    const listed = asList(vpPayload?.vp?.verifiableCredential)
    if (listed.length !== 1 || typeof listed[0] !== 'string') throw new Error('Not one certificate')
    ;({ jwt: credentialJwt, disclosures } = split(listed[0]))
    header = decodeHeader(credentialJwt)
    payload = decodePayload(credentialJwt)
    if (!payload?.vc) throw new Error('Not a W3C JWT-VC')
  } catch {
    checks.presentation_valid = false
    return result('INDETERMINATE')
  }
  // What the holder disclosed, each against a digest the issuer signed.
  try {
    payload = reveal(payload, disclosures)
    checks.disclosures_valid = true
  } catch {
    checks.disclosures_valid = false
    return result('INVALID_SIGNATURE', asList(payload.vc.type).map(String))
  }
  const vc = payload.vc
  const types = asList(vc.type).map(String)
  const issuer = String((typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id) ?? '')
  const { id: subject, ...attributes } = (vc.credentialSubject ?? {}) as Record<string, unknown>
  const holder = String(vpPayload.iss ?? '')
  evidence.issuer = issuer
  evidence.key_id = header.kid
  const validFrom = secondsOf(vc.validFrom ?? vc.issuanceDate) ?? payload.nbf
  const validUntil = secondsOf(vc.validUntil ?? vc.expirationDate) ?? payload.exp
  evidence.valid_from = iso(validFrom)
  evidence.valid_until = iso(validUntil)
  evidence.attributes = attributes
  const schemaIds = asList(vc.credentialSchema)
    .map((schema: any) => String(schema?.id ?? ''))
    .filter(Boolean)
  evidence.schemas = schemaIds
  const missingFields = fields.mandatory.filter((name) => !(name in attributes))

  // The presentation: the holder's did:key signed it, for this exchange.
  const nowSeconds = now / 1000
  let presentationSigned = false
  try {
    const key = await didKeyJwk(holder)
    presentationSigned =
      Boolean(key) &&
      vpHeader?.alg === 'ES256' &&
      String(vpHeader?.kid ?? '').split('#')[0] === holder &&
      verifyEs256(vpJwt, key!)
  } catch {
    presentationSigned = false
  }
  const audiences = asList(vpPayload.aud)
  const fresh =
    typeof vpPayload.iat === 'number' &&
    nowSeconds - vpPayload.iat <= PRESENTATION_MAX_AGE_SECONDS &&
    vpPayload.iat <= nowSeconds + CLOCK_SKEW_SECONDS &&
    (typeof vpPayload.exp !== 'number' || vpPayload.exp > nowSeconds - CLOCK_SKEW_SECONDS)
  const forThisExchange = vpPayload.nonce === challenge && audiences.includes(domain) && fresh
  const oneHolder = (vpPayload.sub ?? holder) === holder && (vpPayload.vp?.holder ?? holder) === holder
  checks.presentation_valid = presentationSigned && forThisExchange && oneHolder && missingFields.length === 0
  // The certificate is the presenter's: bound to the DID that signed.
  checks.holder_bound = presentationSigned && oneHolder && subject === holder

  // The issuer's signature, with its key in the DIDR when the certificate was issued.
  try {
    const key = header.kid
      ? await issuerKey(issuer, String(header.kid), iso(validFrom ?? payload.iat) ?? undefined)
      : null
    checks.issuer_key_valid = Boolean(key)
    checks.signature_valid =
      Boolean(key) && (!payload.iss || payload.iss === issuer) && verifyEs256(credentialJwt, key!)
  } catch {
    checks.issuer_key_valid = null
    checks.signature_valid = null
  }

  // Accredited, from the TI up to the RootTAO.
  try {
    const walked = await walkTrustChain(issuer, vc.termsOfUse, schemaIds, types)
    evidence.trust_chain = walked.chain
    checks.issuer_accredited = walked.ok
    if (!walked.ok) evidence.reason = walked.reason
  } catch {
    checks.issuer_accredited = null
  }

  // The schemas the TSR holds, over the whole certificate.
  try {
    checks.schemas_valid = await validateSchemas(schemaIds, vc)
  } catch {
    checks.schemas_valid = null
  }

  // In force now, by its own dates.
  const notYet = typeof validFrom === 'number' && validFrom > nowSeconds + CLOCK_SKEW_SECONDS
  const expired = typeof validUntil === 'number' && validUntil <= nowSeconds
  checks.time_valid = !notYet && !expired

  // The record on the certificate registry, through the Ledger API, under the
  // key computed from the certificate's TI and id: the certificate's own, and
  // its standing.
  let standing: string | undefined
  const ledger = ledgerEntryOf(vc)
  const statusKey = statusKeyOfCredential(vc)
  if (ledger && statusKey && ledger.contract.toLowerCase() === certificates.registry()) {
    try {
      const record = await readCertificateStatus(statusKey)
      standing = record.standing
      evidence.ledger = {
        contract: ledger.contract.toLowerCase(),
        standing: record.standing,
        certificate_number: String(vc?.credentialSubject?.certificateNumber ?? '') || null,
        registered_at: iso(record.registeredAt),
        changed_at: iso(record.changedAt),
      }
      checks.status_available = record.standing !== 'none'
      if (checks.status_available) {
        const differs = recordDiffers(record, vc, credentialJwt)
        checks.record_matches = differs.length === 0
        if (differs.length)
          evidence.reason = `The record on the certificate registry is not this certificate's (${differs.join(', ')})`
        checks.standing_valid = record.standing === 'valid'
      }
    } catch {
      checks.status_available = false
    }
  } else {
    checks.status_available = false
  }

  if (checks.signature_valid === false || checks.issuer_key_valid === false)
    return result('INVALID_SIGNATURE', types, missingFields)
  if (checks.presentation_valid !== true || checks.holder_bound !== true)
    return result('INDETERMINATE', types, missingFields)
  // A DID registry or trusted issuers registry that could not be read (null, not
  // false) says nothing against the issuer: like the console's verifier, the
  // verification cannot be completed, rather than the issuer being untrusted.
  if (checks.signature_valid === null || checks.issuer_accredited === null)
    return result('INDETERMINATE', types, missingFields)
  if (checks.issuer_accredited !== true) return result('UNTRUSTED_ISSUER', types, missingFields)
  if (checks.signature_valid !== true || checks.schemas_valid !== true)
    return result('INDETERMINATE', types, missingFields)
  // Past its date it is expired, whatever else it is; before, suspended and
  // revoked read alike: not valid.
  if (expired) return result('EXPIRED', types, missingFields)
  if (checks.record_matches === false) return result('INDETERMINATE', types, missingFields)
  if (standing === 'suspended' || standing === 'revoked') return result('INVALID', types, missingFields)
  if (notYet) return result('NOT_YET_VALID', types, missingFields)
  if (checks.status_available !== true || standing !== 'valid')
    return result('STATUS_UNAVAILABLE', types, missingFields)
  return result('VALID', types, missingFields)
}
