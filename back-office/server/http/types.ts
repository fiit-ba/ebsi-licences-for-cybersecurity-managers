import type { walletBackupHttp } from '../backup/http.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { postgresAccounts } from '../identity/auth/accounts.ts';
import type { operatorTokens } from '../identity/auth/tokens.ts';
import type { postgresOperatorManagement } from '../identity/administration/management.ts';
import type { postgresSchemaCatalog } from '../schemas/catalog.ts';
import type { registrySchemas } from '../schemas/registry-schemas.ts';
import type { postgresIssuanceSchemes } from '../issuance/schemes.ts';
import type { createIssuer } from '../issuance/issuer.ts';
import type { walletPresentationProfile } from '../verification/http-profile.ts';
import type { postgresCertificateList } from '../lifecycle/certificates.ts';
import type { postgresStatusProposals } from '../lifecycle/proposals.ts';
import type { postgresEmergencySuspension } from '../lifecycle/emergency.ts';
import type { postgresNotifications } from '../lifecycle/notifications.ts';
import type { postgresAudit } from '../audit/service.ts';
import type { postgresInvitations } from '../accreditation/invitations.ts';
import type { postgresTrustChain } from '../accreditation/chain.ts';
import type { postgresAccreditation } from '../accreditation/revalidation.ts';
import type { postgresPasswordRecovery } from '../identity/recovery/password-recovery.ts';
import type { configuredVerification } from '../verification/runtime.ts';
import type { postgresConsoleGovernance } from '../lifecycle/console-governance.ts';

/** Existing HTTP composition dependencies, with optional feature adapters supplied explicitly. */
export interface BackOfficeServerOptions {
  walletBackups?: ReturnType<typeof walletBackupHttp>;
  accounts: ReturnType<typeof postgresAccounts>;
  tokens: ReturnType<typeof operatorTokens>;
  passwordRecovery?: ReturnType<typeof postgresPasswordRecovery>;
  trustedProxyHops?: number;
  loginThrottle?: (address: string) => Promise<number | null>;
  operatorManagement?: ReturnType<typeof postgresOperatorManagement>;
  schemaCatalog?: ReturnType<typeof postgresSchemaCatalog>;
  /** The certificate schemas read from the Trusted Schemas Registry. */
  registrySchemas?: ReturnType<typeof registrySchemas>;
  issuanceSchemes?: ReturnType<typeof postgresIssuanceSchemes>;
  issuer?: ReturnType<typeof createIssuer>;
  presentations?: Awaited<ReturnType<typeof walletPresentationProfile>>;
  verification?: Awaited<ReturnType<typeof configuredVerification>>;
  consoleVerifierName?: string;
  listCertificates?: ReturnType<typeof postgresCertificateList>;
  notifications?: ReturnType<typeof postgresNotifications>;
  statusProposals?: ReturnType<typeof postgresStatusProposals>;
  emergencySuspend?: ReturnType<typeof postgresEmergencySuspension>;
  audit?: ReturnType<typeof postgresAudit>;
  listAnchors?: (
    actor: number,
    query: URLSearchParams,
  ) => Promise<{ results: unknown[]; next?: string | null }>;
  invitations?: ReturnType<typeof postgresInvitations>;
  trustChain?: ReturnType<typeof postgresTrustChain>;
  accreditation?: ReturnType<typeof postgresAccreditation>;
  consoleAssets?: (request: IncomingMessage, response: ServerResponse) => boolean;
  registrationEnabled?: boolean;
  registrationThrottle?: (address: string) => Promise<number | null>;
  governanceProfile?: {
    contract: string;
    consoleRoles: readonly string[];
    /** The governance contract an account's console works with: its organization's TAO's. */
    contractOf?(accountId: number): Promise<string | undefined>;
  };
  governance?: ReturnType<typeof postgresConsoleGovernance>;
  ready?: () => Promise<unknown>;
  reportError?: (error: unknown) => void;
}
