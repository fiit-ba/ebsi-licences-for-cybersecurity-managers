import type { Protection } from '../issuance/protection.ts';
/** Organization level in the existing accreditation hierarchy. */
export type OrganizationKind = 'rtao' | 'tao' | 'ti';

/** Existing deployment policy for issuing and renewing one-time organization invitations. */
export interface InvitationOptions {
  invitationDays?: number;
  maxAccreditationDays?: number;
  governanceEnabled?: boolean;
  protection?: Protection;
  /** Whether the DID Registry knows a DID: an organization is appointed by its own DID. */
  didRegistered?: (did: string) => Promise<boolean>;
  onboard?: (organization: string, actor: number) => Promise<void>;
  /** Check an organization's accreditation in EBSI's registries (onboarding's `check`). */
  check?: (organization: string, actor: number) => Promise<EbsiAccreditation>;
  refresh?: (organization: string) => Promise<void>;
  withdraw?: (organization: string) => Promise<void>;
  reportIntegrationError?: (operation: string) => void;
}

/** Stored organization identity, grants and revocation fields returned by hierarchy queries. */
export interface OrganizationRow {
  id: string;
  parent_id: string | null;
  name: string;
  kind: OrganizationKind;
  contact_email: string;
  account_id: number | null;
  account: string | null;
  selector: string;
  selected_at: Date;
  registered_at: Date | null;
  invitation_expires_at: Date | null;
  accredited_until: Date | null;
  revoked_at: Date | null;
  revocation_reason: string;
  revocation_note: string;
  did: string | null;
  tir_attribute_id: string | null;
  schemas: string[];
}

/** Hierarchy row augmented with the snapshot time and schemas available for delegation. */
export interface ScopedOrganizationRow extends OrganizationRow {
  observed_at: Date;
  available_schemas: { credential_type: string; name: { sk: string; en: string } }[];
}

/** Public organization projection retaining its optional nested TI descendants. */
export interface OrganizationView {
  organization_id: string;
  name: string;
  kind: OrganizationKind;
  contact_email: string;
  selected_by: string;
  selected_at: Date;
  account: string | null;
  registered_at: Date | null;
  invitation_expires_at: Date | null;
  schemas: string[];
  did: string | null;
  is_issuer: boolean;
  accredited_until: Date | null;
  accreditation_ended: boolean;
  revoked: {
    revoked_at: Date | null;
    reason: string;
    note: string;
    own: boolean;
    organization: string;
    organization_kind: OrganizationKind;
  } | null;
  accredited?: OrganizationView[];
}

/** An appointed organization's accreditation in EBSI, as checked in the registries. */
export interface EbsiAccreditation {
  did: string;
  /** The credential its accreditor issued, for it to store in the Trusted Issuers Registry. */
  accreditation: string | null;
  attribute_id: string | null;
  /** The back-office's keys its DID document must list, and whether it does. */
  keys: {
    purpose: string;
    kid: string;
    public_jwk: unknown;
    relationships: string[];
    listed: boolean;
  }[];
  /** Whether the registry holds the credential, with the keys listed. */
  accredited: boolean;
}
