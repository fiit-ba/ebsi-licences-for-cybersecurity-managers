import type { StatusAction } from './certificate-status.ts';

/** Open status request summarized for the operator's sign-in notice. */
export interface OperatorNotification {
  proposal_id: string;
  credential_id: string;
  reference: string;
  issuer: string;
  action: StatusAction;
  proposed_by: string;
  proposed_at: string;
  approved: boolean;
  onchain_proposal_id: string | null;
  onchain_state: string;
  can_approve: boolean;
}

/** Newest ten visible requests and counts over the complete visible open set. */
export interface OperatorNotifications {
  items: OperatorNotification[];
  total: number;
  waiting: number;
}
