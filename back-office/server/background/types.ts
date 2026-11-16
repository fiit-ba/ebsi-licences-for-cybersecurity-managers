/** Existing domain operations carried by the broker; no private business data crosses Redis. */
export type BackgroundTask =
  | { operation: 'record-standing'; certificateId: string }
  | {
      operation:
        | 'submit-governance-proposal'
        | 'submit-governance-signature'
        | 'reconcile-governance-proposal'
        | 'withdraw-governance-proposal';
      proposalId: string;
    }
  | { operation: 'submit-timestamp'; anchorId: string }
  | { operation: 'send-recovery'; accountId: number }
  | { operation: 'withdraw-accreditation'; organizationId: string }
  | { operation: 'onboard-issuer'; organizationId: string }
  | {
      operation:
        | 'sweep-governance'
        | 'sweep-standing'
        | 'sweep-timestamps'
        | 'purge-signing-intents'
        | 'purge-presentation-attributes'
        | 'revalidate-accreditation';
    };

/** Governance progress that must wait for the proposing transaction before signing. */
export class ProposalPending extends Error {
  /** Create a retryable result for a signature waiting on proposal submission. */
  constructor() {
    super('The proposal is awaiting ledger delivery.');
  }
}
