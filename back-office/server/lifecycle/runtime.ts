import type { Pool } from 'pg';
import type { Protection } from '../issuance/protection.ts';
import { configuredFieldProtection } from '../keys/field-protection.ts';
import { postgresCertificateList } from './certificates.ts';
import { postgresStatusProposals } from './proposals.ts';
import { postgresEmergencySuspension } from './emergency.ts';
import { postgresAudit } from '../audit/service.ts';

/**
 * Configure explicit local lifecycle operation when no governance contract is configured.
 * @param database - PostgreSQL pool containing migrated or independently registered records.
 * @param env - Deployment settings; defaults to process.env.
 * @param protectedFields - Optional already-composed, in-memory protection for isolated fixtures.
 * @returns Local registry, decision, emergency and audit operations, or undefined when disabled.
 * @throws Error for invalid enablement, a conflicting contract/issuance mode or missing protection.
 * @remarks Local decisions require separate-person approval and make no chain calls. This mode
 * does not enable credential signing or claim external ledger verification of a local decision.
 */
export function configuredLocalLifecycle(
  database: Pool,
  env = process.env,
  protectedFields?: Protection & { close?(): void },
) {
  const enabled = env.BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED ?? 'false';
  if (enabled === 'false') return undefined;
  if (enabled !== 'true')
    throw new Error('BACK_OFFICE_LOCAL_LIFECYCLE_ENABLED must be true or false.');
  if (
    env.PLR_GOVERNANCE_CONTRACT?.trim() ||
    (env.BACK_OFFICE_ISSUANCE_ENABLED !== undefined && env.BACK_OFFICE_ISSUANCE_ENABLED !== 'false')
  )
    throw new Error(
      'Local lifecycle mode requires no governance contract and disabled ledger issuance.',
    );
  const protection = protectedFields ?? configuredFieldProtection(database, env);
  const mode = { governanceEnabled: false, protection };
  return {
    close: () => protection.close?.(),
    auditProtection: protection,
    audit: postgresAudit(database, protection),
    listCertificates: postgresCertificateList(database, protection, mode),
    statusProposals: postgresStatusProposals(database, mode),
    emergencySuspend: postgresEmergencySuspension(database, mode),
  };
}
