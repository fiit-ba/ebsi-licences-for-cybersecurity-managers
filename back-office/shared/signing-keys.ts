/** Distinct signing purposes with independent key material and DID relationships. */
export type SigningPurpose = keyof typeof signingPurposes;

export const signingPurposes = {
  credential_signing: { curve: 'P-256', relationship: 'assertionMethod' },
  did_authentication: { curve: 'P-256', relationship: 'authentication' },
  ledger_transactions: { curve: 'secp256k1', relationship: 'capabilityInvocation' },
  timestamp_transactions: { curve: 'secp256k1', relationship: 'capabilityInvocation' },
} as const;

/** Public signing-key history, excluding KMS locators and all private material. */
export interface SigningKeyView {
  key_id: string;
  organization_id: string;
  purpose: SigningPurpose;
  curve: 'P-256' | 'secp256k1';
  state: 'pending' | 'active' | 'retired';
  public_jwk: { kty: 'EC'; crv: 'P-256' | 'secp256k1'; x: string; y: string };
  created_at: Date | null;
  activated_at: Date | null;
  retired_at: Date | null;
}
