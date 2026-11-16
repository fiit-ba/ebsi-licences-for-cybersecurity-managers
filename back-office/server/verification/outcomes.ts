/** Verifier verdicts, in the order used to combine several credentials. */
export const severity = [
  'INVALID_SIGNATURE',
  'UNTRUSTED_ISSUER',
  'REVOKED',
  'EXPIRED',
  'NOT_YET_VALID',
  'SUSPENDED',
  'STATUS_UNAVAILABLE',
  'INDETERMINATE',
  'VALID',
] as const;

/** Credential decision and evidence, excluding the holder DID and token. */
export interface CredentialOutcome {
  state: (typeof severity)[number];
  reason: string;
  checks: Record<string, boolean | null>;
  issuer: string;
  types: string[];
  valid_from: string | null;
  valid_until: string | null;
  statusPurpose: string | null;
  scope: 'credential' | 'presentation';
  checked_at: string;
  key_id: string | null;
  resolved_at: string | null;
  trust_chain: { did: string; role: string; accredited_by: string | null }[];
  schemas: string[];
  ledger: Record<string, unknown> | null;
  attributes: Record<string, unknown>;
  certification_body: Record<string, unknown> | null;
}

/** Aggregated presentation result with the worst credential's checks. */
export interface PresentationOutcome {
  state: CredentialOutcome['state'];
  reason: string;
  acceptable: boolean;
  statusPurpose?: string | null;
  credential_types: string[];
  checks?: Record<string, boolean | null>;
  credentials?: CredentialOutcome[];
}

/** Internal short circuit carrying a refusal, distinct from dependency failure. */
export class VerificationStop extends Error {
  readonly state: CredentialOutcome['state'];
  readonly check: string;
  /**
   * Describe the first failed verification condition.
   * @param state - Verdict category.
   * @param message - Public refusal explanation.
   * @param check - Conjunction member that failed.
   */
  constructor(state: CredentialOutcome['state'], message: string, check: string) {
    super(message);
    this.state = state;
    this.check = check;
  }
}

/**
 * Format evidence timestamps to whole UTC seconds.
 * @param value - Milliseconds since the Unix epoch.
 * @returns ISO timestamp without fractional seconds.
 */
export function evidenceTime(value: number) {
  return new Date(value)
    .toISOString()
    .replace('.000Z', 'Z')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Initialize unevaluated verification checks and empty evidence.
 * @param now - Evaluation instant.
 * @param presentation - Whether the caller supplied presentation verification.
 * @returns Fresh credential outcome; no shared mutable arrays or check flags.
 */
export function emptyOutcome(now: Date, presentation: boolean): CredentialOutcome {
  return {
    state: 'VALID',
    reason: '',
    checks: Object.fromEntries(
      [
        'presentation_valid',
        'signature_valid',
        'issuer_key_valid',
        'disclosures_valid',
        'time_valid',
        'holder_bound',
        'issuer_accredited',
        'schemas_valid',
        'status_available',
        'record_matches',
        'standing_valid',
      ].map((name) => [name, null]),
    ),
    issuer: '',
    types: [],
    valid_from: null,
    valid_until: null,
    statusPurpose: null,
    scope: presentation ? 'presentation' : 'credential',
    checked_at: evidenceTime(+now),
    key_id: null,
    resolved_at: null,
    trust_chain: [],
    schemas: [],
    ledger: null,
    attributes: {},
    certification_body: null,
  };
}

/**
 * Decode JSON JWT claims without treating them as verified.
 * @param token - Compact JWS.
 * @returns Header and payload objects.
 * @throws VerificationStop for malformed compact JSON.
 */
export function unverified(token: string): {
  header: Record<string, any>;
  payload: Record<string, any>;
} {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const [header, payload] = parts
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
    if (
      !header ||
      !payload ||
      Array.isArray(header) ||
      Array.isArray(payload) ||
      typeof header !== 'object' ||
      typeof payload !== 'object'
    )
      throw new Error();
    return { header, payload };
  } catch {
    throw new VerificationStop('INVALID_SIGNATURE', 'Not a compact JWS', 'signature_valid');
  }
}

/**
 * Parse the optional ISO or NumericDate validity bounds.
 * @param value - JSON timestamp or absent value.
 * @returns Epoch milliseconds, or null when absent/invalid.
 */
export function verificationTime(value: unknown): number | null {
  if (value == null || value === '') return null;
  const result = typeof value === 'number' ? value * 1000 : Date.parse(String(value));
  return Number.isFinite(result) ? result : null;
}

/**
 * Select credential validity, preferring VC fields over containing JWT bounds.
 * @param vc - Signed credential document.
 * @param payload - Optional containing JWT claims.
 * @returns Start/end in epoch milliseconds, or null for an absent bound.
 */
export function validityWindow(vc: Record<string, any>, payload: Record<string, any> = {}) {
  return {
    start: verificationTime(vc.validFrom || vc.issuanceDate) ?? verificationTime(payload.nbf),
    end: verificationTime(vc.validUntil || vc.expirationDate) ?? verificationTime(payload.exp),
  };
}
