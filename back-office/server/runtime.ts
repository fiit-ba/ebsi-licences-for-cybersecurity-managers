import type { Pool } from 'pg';
import { trustedSchemaRegistry } from './schemas/tsr.ts';
import { configuredOrganizations } from './accreditation/runtime.ts';
import { configuredIssuer } from './issuance/runtime.ts';
import { configuredTimestamp } from './audit/runtime.ts';
import { configuredLocalLifecycle } from './lifecycle/runtime.ts';
import { configuredPasswordRecovery } from './identity/recovery/recovery-runtime.ts';

/**
 * Compose the same domain adapters for the independent API and worker processes.
 * @param database - Process-owned PostgreSQL pool.
 * @returns Domain services and their owned-client cleanup; no HTTP listener or task polling.
 * @throws Invalid configuration and adapter initialization errors.
 */
export async function configuredDomains(database: Pool) {
  const registry = trustedSchemaRegistry(
    process.env.PLR_TSR_URL ?? 'https://api-pilot.ebsi.eu/trusted-schemas-registry/v3',
  );
  const passwordRecovery = configuredPasswordRecovery(database);
  const localLifecycle = configuredLocalLifecycle(database);
  const organizations = configuredOrganizations(database, registry);
  let issuer: Awaited<ReturnType<typeof configuredIssuer>>;
  let timestamp: Awaited<ReturnType<typeof configuredTimestamp>>;
  try {
    issuer = await configuredIssuer(
      database,
      registry,
      process.env,
      organizations.accreditation.ensureAccredited,
      // A first issuance asks for its TI's onboarding (in development, of the worker).
      organizations.onboardIssuer,
    );
    timestamp = await configuredTimestamp(database, process.env, issuer?.ledgerSignerAddresses);
    return {
      registry,
      passwordRecovery,
      localLifecycle,
      organizations,
      issuer,
      timestamp,
      /** Release domain-owned providers after requests/jobs finish. @returns Completion after resource cleanup. */
      async close() {
        await issuer?.close();
        organizations.close();
        timestamp?.close();
        localLifecycle?.close();
      },
    };
  } catch (error) {
    await issuer?.close();
    organizations.close();
    timestamp?.close();
    localLifecycle?.close();
    throw error;
  }
}

/** Domain composition shared by API requests and broker task dispatch. */
export type Domains = Awaited<ReturnType<typeof configuredDomains>>;
