/** Operator roles understood by the independently implemented Back Office. */
export type OperatorRole = (typeof operatorRoles)[number];

export const operatorRoles = [
  'plr_admin',
  'plr_issuer',
  'plr_status_manager',
  'plr_verifier',
  'plr_auditor',
  'plr_tao',
  'plr_rtao',
] as const;

/** Account administration projection; password hashes are never returned. */
export interface ManagedOperator {
  id: number;
  username: string;
  email: string;
  active: boolean;
  version: number;
  roles: OperatorRole[];
  organization: { organization_id: string; name: string; kind: string; revoked: boolean } | null;
}

/** Bounded page of accounts visible to an active administrator. */
export interface OperatorPage {
  results: ManagedOperator[];
  total: number;
  next: number | null;
}
