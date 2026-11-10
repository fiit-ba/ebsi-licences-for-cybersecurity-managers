import { configuredDomains } from '../runtime.ts';
import { consoleLedgerProxy } from './ledger-proxy.ts';
import { walletBackupHttp } from '../backup/http.ts';
import { postgresWalletBackups } from '../backup/service.ts';
import { postgresBackupThrottle } from '../backup/throttle.ts';
import { clientAddress } from './client-address.ts';
import { postgresDecisionAnchors } from '../audit/decisions.ts';
import { postgresConsoleGovernance } from '../lifecycle/console-governance.ts';
import { postgresOperatorManagement } from '../identity/administration/management.ts';
import { postgresNotifications } from '../lifecycle/notifications.ts';
import { postgresAudit } from '../audit/service.ts';
import { postgresIssuanceSchemes } from '../issuance/schemes.ts';
import { postgresSchemaManagement } from '../schemas/management.ts';
import { postgresTrustChain } from '../accreditation/chain.ts';
import { postgresInvitations } from '../accreditation/invitations.ts';
import pg from 'pg';
import { postgresAccounts } from '../identity/auth/accounts.ts';
import { operatorTokens } from '../identity/auth/tokens.ts';
import { postgresSchemaCatalog } from '../schemas/catalog.ts';
import { backOfficeServer } from './app.ts';
import { loadConsoleAssets } from './console.ts';
import { postgresLoginThrottle } from '../identity/auth/login-throttle.ts';
import { postgresRegistrationThrottle } from '../accreditation/registration-throttle.ts';

const tokens = operatorTokens(process.env.BACK_OFFICE_TOKEN_SECRET);
const database = new pg.Pool({ connectionTimeoutMillis: 3000 });
const domains = await configuredDomains(database);
const { registry, passwordRecovery, localLifecycle, organizations, issuer, timestamp } = domains;
database.on('error', (error) => console.error('Idle database connection failed', error));

const consoleEnabled = process.env.BACK_OFFICE_CONSOLE_ENABLED ?? 'true';
if (!['true', 'false'].includes(consoleEnabled))
  throw new Error('BACK_OFFICE_CONSOLE_ENABLED must be true or false.');
const consoleAssets =
  consoleEnabled === 'true'
    ? await loadConsoleAssets(new URL('../../web/dist/', import.meta.url))
    : undefined;
const ready = async () => {
  await database.query('SELECT 1 FROM plr_walletbackup LIMIT 0');
  await database.query('SELECT 1 FROM wallet_backup_limits LIMIT 0');
  await database.query(
    'SELECT auth_version, first_name, last_name, is_staff, is_superuser FROM operator_accounts LIMIT 0',
  );
  await database.query('SELECT 1 FROM operator_roles LIMIT 0');
  await database.query('SELECT 1 FROM operator_governance_roles LIMIT 0');
  await database.query('SELECT 1 FROM operator_account_permissions LIMIT 0');
  await database.query('SELECT 1 FROM operator_account_groups LIMIT 0');
  await database.query('SELECT 1 FROM operator_group_permissions LIMIT 0');
  await database.query('SELECT 1 FROM operator_permissions LIMIT 0');
  await database.query('SELECT 1 FROM operator_login_limits LIMIT 0');
  await database.query('SELECT 1 FROM organization_registration_limits LIMIT 0');
  if (passwordRecovery) {
    await database.query('SELECT account_id, token_digest FROM operator_password_resets LIMIT 0');
    await database.query('SELECT bucket FROM operator_recovery_limits LIMIT 0');
  }
  await database.query('SELECT 1 FROM accredited_organizations LIMIT 0');
  await database.query('SELECT 1 FROM certificate_schema_versions LIMIT 0');
  await database.query('SELECT 1 FROM accreditation_events LIMIT 0');
  await database.query('SELECT 1 FROM accreditation_withdrawals LIMIT 0');
  await database.query('SELECT 1 FROM organization_key_requests LIMIT 0');
  await database.query('SELECT 1 FROM issuer_accreditation_checks LIMIT 0');
  await database.query('SELECT 1 FROM schema_events LIMIT 0');
  await database.query('SELECT 1 FROM audit_entries LIMIT 0');
  const { rowCount: auditHead } = await database.query('SELECT 1 FROM audit_head WHERE singleton');
  if (auditHead !== 1) throw new Error('Audit head is missing.');
  await database.query('SELECT entry_id, digest, raw_transaction FROM audit_anchors LIMIT 0');
  if (issuer || localLifecycle) {
    await database.query('SELECT 1 FROM issuer_signing_keys LIMIT 0');
    await database.query('SELECT 1 FROM credential_tokens LIMIT 0');
    await database.query('SELECT 1 FROM presentation_requests LIMIT 0');
    await database.query('SELECT 1 FROM presentation_results LIMIT 0');
    await database.query('SELECT 1 FROM verify_flows LIMIT 0');
    await database.query('SELECT 1 FROM relying_parties LIMIT 0');
    await database.query(
      'SELECT closed_at, onchain_state, withdrawal_requested_at FROM certificate_status_proposals LIMIT 0',
    );
    await database.query('SELECT 1 FROM certificate_emergency_suspensions LIMIT 0');
    await database.query('SELECT local_standing FROM registered_certificates LIMIT 0');
    await database.query(
      'SELECT requires_governance, delivery_uncertain FROM certificate_status_proposals LIMIT 0',
    );
  }
};

const server = backOfficeServer({
  walletBackups: walletBackupHttp({
    backups: postgresWalletBackups(
      database,
      Number(process.env.PLR_WALLET_BACKUP_MAX_BYTES ?? 128 * 1024 * 1024),
    ),
    throttle: postgresBackupThrottle(
      database,
      process.env.BACK_OFFICE_TOKEN_SECRET!,
      process.env.PLR_WALLET_BACKUP_RATE ?? '30/min',
    ),
    address: (request) => clientAddress(request, Number(process.env.PLR_NUM_PROXIES ?? 0)),
  }),
  accounts: postgresAccounts(database),
  tokens,
  passwordRecovery,
  trustedProxyHops: Number(process.env.PLR_NUM_PROXIES ?? 0),
  loginThrottle: postgresLoginThrottle(
    database,
    process.env.BACK_OFFICE_TOKEN_SECRET!,
    Number(process.env.BACK_OFFICE_LOGIN_ATTEMPTS_PER_MINUTE ?? 30),
  ),
  operatorManagement: postgresOperatorManagement(database, passwordRecovery?.queueActivation),
  notifications: postgresNotifications(
    database,
    issuer?.auditProtection ?? localLifecycle?.auditProtection,
  ),
  trustChain: postgresTrustChain(database),
  invitations: postgresInvitations(database, organizations.invitationOptions),
  accreditation: organizations.accreditation,
  registrationThrottle: postgresRegistrationThrottle(
    database,
    process.env.BACK_OFFICE_TOKEN_SECRET!,
    process.env.PLR_ORGANIZATION_REGISTRATION_RATE ?? '10/hour',
  ),
  registrationEnabled: process.env.PLR_ORGANIZATION_REGISTRATION_ENABLED !== 'false',
  governanceProfile: {
    contract: process.env.PLR_GOVERNANCE_CONTRACT ?? '',
    consoleRoles: (process.env.PLR_GOVERNANCE_CONSOLE_ROLES ?? 'A,B')
      .split(',')
      .map((role) => role.trim().toUpperCase())
      .filter(Boolean),
  },
  schemaManagement: postgresSchemaManagement(database, registry, organizations.schemaOptions),
  issuer,
  governance: issuer?.governance ?? postgresConsoleGovernance(database),
  consoleAssets,
  audit: issuer?.audit ?? localLifecycle?.audit ?? postgresAudit(database),
  listAnchors: postgresDecisionAnchors(
    database,
    issuer?.auditProtection ?? localLifecycle?.auditProtection,
    timestamp?.ledger,
  ),
  verification: issuer?.verification,
  consoleVerifierName: process.env.PLR_CONSOLE_VERIFIER_NAME,
  listCertificates: issuer?.listCertificates ?? localLifecycle?.listCertificates,
  statusProposals: issuer?.statusProposals ?? localLifecycle?.statusProposals,
  emergencySuspend: issuer?.emergencySuspend ?? localLifecycle?.emergencySuspend,
  issuanceSchemes: postgresIssuanceSchemes(database),
  schemaCatalog: postgresSchemaCatalog(database),
  ready,
});
// The combined runtime serves the same API prefixes as Vite and the staff edge.
if (process.env.PLR_LEDGER_RPC_URL) {
  const proxy = consoleLedgerProxy(process.env.PLR_LEDGER_RPC_URL);
  const dispatch = server.listeners('request')[0] as (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => void;
  server.removeAllListeners('request');
  server.on('request', (request, response) => {
    void proxy(request, response)
      .then((handled) => {
        if (!handled) dispatch(request, response);
      })
      .catch(() => {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ detail: 'Service unavailable.' }));
      });
  });
}
await ready();
server.listen(Number(process.env.PORT ?? 8088), process.env.HOST ?? '127.0.0.1');

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    // Stop admission first; finish requests and active batches before closing clients.
    const requests = new Promise<void>((resolve) => server.close(() => resolve()));
    void requests
      .then(async () => {
        await domains.close();
        await database.end();
      })
      .catch(() => {
        console.error('Runtime shutdown failed.');
        process.exitCode = 1;
      });
  });
}
