import type { Pool, PoolClient } from 'pg';
import type { OrganizationRow, InvitationOptions } from './types.ts';
import { transaction } from '../adapters/transaction.ts';
import { appendAudit } from '../audit/journal.ts';
import { createHash, randomInt } from 'node:crypto';
import { hashPassword } from '../identity/auth/passwords.ts';
import { passwordPolicyCodes } from '../identity/auth/password-policy.ts';
import { registrationInput } from './registration-input.ts';
import { trimIdentityField } from '../identity/input-text.ts';
import { maxReasonCharacters } from '../../shared/certificate-status.ts';
import { withdrawOrganizationCertificates } from './withdrawal.ts';
import { accreditationDate } from './dates.ts';

const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const revocationReasons = new Set([
  'conditions_not_met',
  'breach',
  'organization_request',
  'supervisory_decision',
  'dissolved',
  'other',
]);
const days = 86_400_000;
const selectorRoles: Partial<Record<string, string>> = { rtao: 'plr_rtao', tao: 'plr_tao' };
const registrationRoles: Partial<Record<string, string[]>> = {
  tao: ['plr_tao'],
  ti: ['plr_issuer', 'plr_status_manager', 'plr_verifier'],
};

/** HTTP-compatible refusal from an accreditation operation. */
export class AccreditationError extends Error {
  readonly status: number;
  readonly body: { reason: string; detail: string } & Record<string, unknown>;
  /**
   * Create an accreditation refusal.
   *
   * @param status - HTTP response status.
   * @param reason - Machine-readable refusal reason.
   * @param detail - Human-readable explanation.
   * @param extra - Additional public response fields.
   */
  constructor(status: number, reason: string, detail: string, extra = {}) {
    super(detail);
    this.status = status;
    this.body = { reason, detail, ...extra };
  }
}

/**
 * Build a public field-validation refusal.
 *
 * @param fields - Names of invalid fields.
 * @returns An AccreditationError with InvalidFields.
 */
function invalid(fields: string[]) {
  return new AccreditationError(400, 'InvalidFields', 'Some fields are missing or invalid', {
    fields,
  });
}

/**
 * Hash an unformatted invitation for database lookup.
 *
 * @param code - Canonical invitation characters without display separators.
 * @returns The SHA-256 invitation digest.
 */
function invitationDigest(code: string) {
  return createHash('sha256').update(code).digest();
}

/**
 * Generate an expiring invitation while separating display and stored secrets.
 *
 * @param lifetimeDays - Existing deployment's configured invitation lifetime.
 * @returns The formatted code, digest of its unformatted value and configured expiry.
 * @throws Crypto errors if secure randomness is unavailable.
 */
function issueInvitation(lifetimeDays: number) {
  const raw = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return {
    code: [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8)].join('-'),
    digest: invitationDigest(raw),
    expiresAt: new Date(Date.now() + lifetimeDays * days),
  };
}

/**
 * Validate a requested TI accreditation end.
 *
 * @param value - Untrusted ISO timestamp.
 * @param now - Current epoch time in milliseconds.
 * @param maximumDays - Configured maximum accreditation duration.
 * @returns A future Date within the configured lifespan.
 * @throws AccreditationError for missing, malformed, past or excessive validity.
 */
function accreditationEnd(value: unknown, now: number, maximumDays: number) {
  let reason;
  if (typeof value !== 'string') reason = 'LifespanRequired';
  const date = accreditationDate(value);
  if (!reason && !date) reason = 'LifespanInvalid';
  if (!reason && +date! <= now) reason = 'LifespanInPast';
  if (!reason && +date! > now + maximumDays * days) reason = 'LifespanTooLong';
  if (reason) {
    throw new AccreditationError(400, reason, 'Enter a valid future accreditation end.', {
      fields: ['accredited_until'],
      codes: reason === 'LifespanTooLong' ? [String(maximumDays)] : [],
    });
  }
  return date!;
}

/**
 * Record accreditation history and its corresponding journal event.
 *
 * @param client - Transaction connection.
 * @param action - Accreditation event name.
 * @param organization - Affected organization ID.
 * @param actor - Acting account ID.
 * @param details - Public event metadata without secrets.
 * @returns Completion of both inserts.
 * @throws Database errors if a query, lock or commit fails.
 */
async function record(
  client: PoolClient,
  action: string,
  organization: string,
  actor: number,
  details: Record<string, unknown> = {},
) {
  await client.query(
    'INSERT INTO accreditation_events (action, organization_id, actor_id, details) VALUES ($1, $2, $3, $4)',
    [action, organization, actor, details],
  );
  const events: Record<string, string> = {
    organization_selected: 'organization.selected',
    organization_invitation_renewed: 'organization.invited',
    organization_lifespan: 'organization.lifespan',
    organization_schema_grants_removed: 'organization.grants_removed',
    organization_schema_grants_changed: 'organization.accredited',
    organization_revoked: 'organization.revoked',
    organization_registered: 'organization.registered',
  };
  await appendAudit(client, {
    event: events[action],
    organizationId: organization,
    actor,
    detail: details,
  });
}

/**
 * Build a registration refusal with compatibility codes.
 *
 * @param status - HTTP status.
 * @param reason - Machine-readable refusal reason.
 * @param codes - Additional public validation codes.
 * @returns The accreditation refusal.
 */
function registrationRefused(status: number, reason: string, codes: string[] = []) {
  return new AccreditationError(status, reason, 'The registration was refused', { codes });
}

/**
 * Lock and resolve schema grants a parent may delegate.
 *
 * @param client - Transaction connection.
 * @param parent - Selecting organization row.
 * @param schemas - Requested credential-type names.
 * @returns Matching schema rows.
 * @throws AccreditationError when a requested schema cannot be delegated; database errors.
 */
async function allowedSchemas(client: PoolClient, parent: OrganizationRow, schemas: string[]) {
  const { rows: allowed } = await client.query(
    `
    SELECT s.id, s.credential_type
    FROM certificate_schemas s
    WHERE s.retired_at IS NULL AND s.credential_type = ANY($1::text[])
      AND ($2 OR EXISTS (
        SELECT 1 FROM organization_certificate_schemas g
        WHERE g.organization_id = $3 AND g.schema_id = s.id
      ))
    FOR SHARE OF s
  `,
    [schemas, parent.kind === 'rtao', parent.id],
  );
  const granted = new Set(allowed.map((schema) => schema.credential_type));
  const refused = [...new Set(schemas)].filter((type) => !granted.has(type)).sort();
  if (refused.length) {
    throw new AccreditationError(403, 'SchemaNotYours', 'Only schemas you hold can be handed on.', {
      credential_types: refused,
    });
  }
  return allowed;
}

/**
 * Lock a direct child after checking and locking its selecting parent.
 *
 * @param client - Transaction connection.
 * @param actor - Current operator account ID; authority is checked against stored roles.
 * @param id - Untrusted child organization ID.
 * @param revokedReason - Refusal reason to use for an already revoked child.
 * @returns The locked child with its parent.
 * @throws AccreditationError for unknown children, lost authority or revoked organizations;
 * database errors.
 * @remarks Parent-first locking serializes descendant selection with changes to parent grants.
 */
async function childForChange(
  client: PoolClient,
  actor: number,
  id: unknown,
  revokedReason = 'Revoked',
) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AccreditationError(404, 'UnknownOrganization', 'Unknown organization.');
  }
  const {
    rows: [target],
  } = await client.query('SELECT parent_id FROM accredited_organizations WHERE id = $1', [id]);
  if (!target) throw new AccreditationError(404, 'UnknownOrganization', 'Unknown organization.');

  // Lock the parent before the child. In particular, removing a TAO grant
  // must serialize with that TAO selecting or updating one of its TIs.
  const {
    rows: [parent],
  } = await client.query(
    `
    SELECT p.*, root.revoked_at AS root_revoked_at,
      ARRAY(SELECT role FROM operator_roles WHERE account_id = a.id) AS roles
    FROM accredited_organizations p
    JOIN operator_accounts a ON a.id = p.account_id AND a.active
    LEFT JOIN accredited_organizations root ON root.id = p.parent_id
    WHERE p.id = $1 AND a.id = $2
    FOR UPDATE OF p, a
  `,
    [target.parent_id, actor],
  );
  if (!parent || !parent.roles.includes(selectorRoles[parent.kind])) {
    throw new AccreditationError(
      403,
      'NotYours',
      'Only the selecting organization can make this change.',
    );
  }
  if (
    [parent.revoked_at, parent.root_revoked_at, parent.accredited_until].some(
      (date) => date && date <= Date.now(),
    )
  ) {
    throw new AccreditationError(
      403,
      'OwnAccreditationRevoked',
      'The accrediting organization has no authority.',
    );
  }
  const {
    rows: [child],
  } = await client.query(
    `
    SELECT * FROM accredited_organizations WHERE id = $1 AND parent_id = $2 FOR UPDATE
  `,
    [id, parent.id],
  );
  if (!child) throw new AccreditationError(404, 'UnknownOrganization', 'Unknown organization.');
  if (child.revoked_at)
    throw new AccreditationError(409, revokedReason, 'The organization was revoked.');
  return { ...child, parent };
}

/**
 * Create transactional organization selection, invitation and registration operations.
 *
 * @param database - PostgreSQL pool.
 * @param options - Invitation/lifespan policy and post-commit registry integration callbacks.
 * @returns Accreditation operations that recheck authority inside each transaction.
 * @throws Error for an unrepresentable invitation lifetime or invalid lifespan maximum; operations propagate their documented domain/database errors.
 */
export function postgresInvitations(database: Pool, options: InvitationOptions = {}) {
  const lifetimeDays = options.invitationDays ?? 14;
  const maximumDays = options.maxAccreditationDays ?? 1826;
  if (!Number.isSafeInteger(maximumDays) || maximumDays < 1)
    throw new Error('Configure a positive whole-day accreditation maximum.');
  const expiry = new Date(Date.now() + lifetimeDays * days);
  if (
    !Number.isSafeInteger(lifetimeDays) ||
    !Number.isFinite(+expiry) ||
    expiry.getUTCFullYear() < 1 ||
    expiry.getUTCFullYear() > 9999
  )
    throw new Error('Configure a representable invitation lifetime in whole days.');
  return {
    /**
     * Select a direct child and issue its initial invitation.
     *
     * @param actor - Selecting account ID.
     * @param input - Name, contact email, delegated schemas and, for a TI, accreditation end.
     * @returns The selected organization ID, invitation and expiry.
     * @throws AccreditationError for invalid fields, authority, lifespan or grants; database
     * errors.
     */
    async select(actor: number, input: Record<string, unknown>) {
      const name = typeof input.name === 'string' ? trimIdentityField(input.name) : '';
      const suppliedEmail = input.contact_email ?? '';
      const email =
        typeof suppliedEmail === 'string' ? trimIdentityField(suppliedEmail) : suppliedEmail;
      const schemas = input.schemas ?? [];
      if (!name || Array.from(name).length > 200) throw invalid(['name']);
      if (
        typeof email !== 'string' ||
        email.length > 254 ||
        (email && !/^[^\s@]+@(?:localhost|[^\s@]+\.[^\s@]+)$/.test(trimIdentityField(email)))
      )
        throw invalid(['contact_email']);
      if (!Array.isArray(schemas) || schemas.some((type) => typeof type !== 'string'))
        throw invalid(['schemas']);

      return transaction(database, async (client) => {
        const {
          rows: [parent],
        } = await client.query(
          `
          SELECT o.*, r.revoked_at AS root_revoked_at,
            ARRAY(SELECT role FROM operator_roles WHERE account_id = a.id) AS roles
          FROM accredited_organizations o
          JOIN operator_accounts a ON a.id = o.account_id AND a.active
          LEFT JOIN accredited_organizations r ON r.id = o.parent_id
          WHERE a.id = $1
          FOR UPDATE OF o, a
        `,
          [actor],
        );
        const role = selectorRoles[parent?.kind];
        if (!role || !parent.roles.includes(role)) {
          throw new AccreditationError(
            403,
            'NoOrganization',
            'Only the accrediting organization can select a child.',
          );
        }
        const now = Date.now();
        if (
          [parent.revoked_at, parent.root_revoked_at, parent.accredited_until].some(
            (date) => date && date <= now,
          )
        ) {
          throw new AccreditationError(
            403,
            'OwnAccreditationRevoked',
            'The accrediting organization has no authority.',
          );
        }
        const kind = parent.kind === 'rtao' ? 'tao' : 'ti';
        const until =
          kind === 'ti' ? accreditationEnd(input.accredited_until, now, maximumDays) : null;

        const allowed = await allowedSchemas(client, parent, schemas);

        const invitation = issueInvitation(lifetimeDays);
        const {
          rows: [organization],
        } = await client.query(
          `
          INSERT INTO accredited_organizations
            (name, kind, parent_id, contact_email, selected_by, accredited_until, invitation_digest, invitation_expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `,
          [name, kind, parent.id, email, actor, until, invitation.digest, invitation.expiresAt],
        );
        await client.query(
          `
          INSERT INTO organization_certificate_schemas
          SELECT $1, unnest($2::uuid[])
        `,
          [organization.id, allowed.map((schema) => schema.id)],
        );
        const types = allowed.map((schema) => schema.credential_type).sort();
        await record(client, 'organization_selected', organization.id, actor, { schemas: types });
        return {
          organization_id: organization.id,
          name,
          kind,
          schemas: types,
          invitation: invitation.code,
          invitation_expires_at: invitation.expiresAt,
          accredited_until: until,
          accreditation_ended: false,
          revoked: null,
        };
      });
    },

    /**
     * Replace an unregistered direct child's invitation.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Organization ID whose invitation must be replaced.
     * @returns The replacement invitation and expiry.
     * @throws AccreditationError for invalid authority, revoked or already registered children;
     * database errors.
     */
    async renew(actor: number, input: Record<string, unknown>) {
      return transaction(database, async (client) => {
        const child = await childForChange(client, actor, input.organization_id);
        const id = child.id;
        if (child.account_id) {
          throw new AccreditationError(
            409,
            'AlreadyRegistered',
            'The organization has already registered.',
          );
        }

        const invitation = issueInvitation(lifetimeDays);
        await client.query(
          `
          UPDATE accredited_organizations SET invitation_digest = $2, invitation_expires_at = $3
          WHERE id = $1
        `,
          [id, invitation.digest, invitation.expiresAt],
        );
        await record(client, 'organization_invitation_renewed', id, actor);
        return { invitation: invitation.code, invitation_expires_at: invitation.expiresAt };
      });
    },

    /**
     * Change or immediately end a selected TI's accreditation.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Organization ID, future accredited_until or end_now flag.
     * @returns The updated accreditation state.
     * @throws AccreditationError for invalid dates, wrong child kind or authority; database errors.
     */
    async setLifespan(actor: number, input: Record<string, unknown>) {
      return transaction(database, async (client) => {
        const child = await childForChange(client, actor, input.organization_id);
        if (child.kind !== 'ti')
          throw new AccreditationError(409, 'NotATI', 'Only a TI has an accreditation end.');
        const now = new Date();
        const endNow = input.end_now === true;
        if (endNow && child.accredited_until && child.accredited_until <= now) {
          throw new AccreditationError(409, 'AlreadyEnded', 'The accreditation has ended already.');
        }
        const end = endNow ? now : accreditationEnd(input.accredited_until, +now, maximumDays);
        await client.query(
          'UPDATE accredited_organizations SET accredited_until = $2 WHERE id = $1',
          [child.id, end],
        );
        await record(client, 'organization_lifespan', child.id, actor, { accredited_until: end });
        return {
          organization_id: child.id,
          accredited_until: end,
          accreditation_ended: endNow,
          revoked: null,
        };
      });
    },

    /**
     * Replace a direct child's delegated schema set.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Organization ID and replacement credential-type names.
     * @returns The updated organization and grants.
     * @throws AccreditationError for invalid or nondelegable schemas and authority; database
     * errors.
     * @remarks Removed TAO grants are removed from its TIs in the same transaction.
     */
    async setSchemas(actor: number, input: Record<string, unknown>) {
      const schemas = input.schemas;
      if (!Array.isArray(schemas) || schemas.some((type) => typeof type !== 'string'))
        throw invalid(['schemas']);
      const result = await transaction(database, async (client) => {
        const child = await childForChange(client, actor, input.organization_id);
        const allowed = await allowedSchemas(client, child.parent, schemas);
        const ids = allowed.map((schema) => schema.id);
        const { rows: removed } = await client.query(
          `
          DELETE FROM organization_certificate_schemas
          WHERE organization_id = $1 AND NOT (schema_id = ANY($2::uuid[]))
          RETURNING schema_id
        `,
          [child.id, ids],
        );
        await client.query(
          `
          INSERT INTO organization_certificate_schemas SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
        `,
          [child.id, ids],
        );
        if (child.kind === 'tao' && removed.length) {
          const { rows } = await client.query(
            `
            DELETE FROM organization_certificate_schemas g USING accredited_organizations ti
            WHERE g.organization_id = ti.id AND ti.parent_id = $1 AND g.schema_id = ANY($2::uuid[])
            RETURNING g.organization_id, g.schema_id
          `,
            [child.id, removed.map((row) => row.schema_id)],
          );
          const lostByOrganization = new Map();
          for (const row of rows) {
            const lost = lostByOrganization.get(row.organization_id) ?? [];
            lost.push(row.schema_id);
            lostByOrganization.set(row.organization_id, lost);
          }
          for (const [id, lost] of lostByOrganization) {
            await record(client, 'organization_schema_grants_removed', id, actor, {
              schema_ids: lost.sort(),
            });
          }
        }
        const types = allowed.map((schema) => schema.credential_type).sort();
        await record(client, 'organization_schema_grants_changed', child.id, actor, {
          schemas: types,
        });
        return { organization_id: child.id, schemas: types };
      });
      try {
        await options.refresh?.(result.organization_id);
      } catch {
        options.reportIntegrationError?.('schema accreditation refresh');
      }
      return result;
    },

    /**
     * Revoke a direct child and record withdrawal work for its affected branch.
     *
     * @param actor - Current operator account ID; authority is checked against stored roles.
     * @param input - Organization ID, allowed reason code and optional note.
     * @returns The organization revocation state and a withdrawal_pending flag.
     * @throws AccreditationError for invalid reason, unknown child or missing authority; database
     * errors.
     * @remarks Disables branch accounts and invitations locally; external withdrawal is queued.
     */
    async revoke(actor: number, input: Record<string, unknown>) {
      const result = await transaction(database, async (client) => {
        const child = await childForChange(client, actor, input.organization_id, 'AlreadyRevoked');
        const reason = typeof input.reason === 'string' ? trimIdentityField(input.reason) : '';
        const note = input.note == null ? '' : trimIdentityField(String(input.note));
        if (!revocationReasons.has(reason)) {
          throw new AccreditationError(
            400,
            'RevocationReasonRequired',
            'Give a revocation reason.',
            {
              fields: ['reason'],
            },
          );
        }
        if (reason === 'other' && !note) {
          throw new AccreditationError(
            400,
            'RevocationNoteRequired',
            'Describe the revocation reason.',
            {
              fields: ['note'],
            },
          );
        }
        if (Array.from(note).length > maxReasonCharacters) {
          throw new AccreditationError(400, 'RevocationNoteTooLong', 'The note is too long.', {
            fields: ['note'],
            codes: ['500'],
          });
        }

        const { rows: descendants } = await client.query(
          `
          SELECT id FROM accredited_organizations WHERE parent_id = $1 ORDER BY id FOR UPDATE
        `,
          [child.id],
        );
        const affected = [child.id, ...descendants.map((row) => row.id)];
        const {
          rows: [revocation],
        } = await client.query(
          `
          UPDATE accredited_organizations
          SET revoked_at = statement_timestamp(), revocation_reason = $2, revocation_note = $3
          WHERE id = $1 RETURNING revoked_at
        `,
          [child.id, reason, note],
        );
        await client.query(
          `
          UPDATE accredited_organizations SET invitation_digest = NULL, invitation_expires_at = NULL
          WHERE id = ANY($1::uuid[])
        `,
          [affected],
        );
        await client.query(
          `
          UPDATE operator_accounts SET active = false
          WHERE id IN (SELECT account_id FROM accredited_organizations WHERE id = ANY($1::uuid[]))
        `,
          [affected],
        );
        await client.query(
          `
          INSERT INTO accreditation_withdrawals
            (revoked_organization_id, affected_organization_id, requested_at, requested_by)
          SELECT $1, unnest($2::uuid[]), $3, $4
        `,
          [child.id, affected, revocation.revoked_at, actor],
        );
        await record(client, 'organization_revoked', child.id, actor, {
          reason,
          organization_ids: affected.slice(1),
        });
        const withdrawn = await withdrawOrganizationCertificates(
          client,
          affected,
          actor,
          options.governanceEnabled ?? true,
          options.protection,
        );
        await client.query(
          'UPDATE accreditation_withdrawals SET certificates_completed_at=clock_timestamp() WHERE revoked_organization_id=$1',
          [child.id],
        );
        return {
          organization_id: child.id,
          accredited_until: child.accredited_until,
          accreditation_ended: true,
          revoked: {
            revoked_at: revocation.revoked_at,
            reason,
            note,
            own: true,
            organization: child.name,
            organization_kind: child.kind,
          },
          withdrawal_pending: true,
          ...withdrawn,
        };
      });
      try {
        await options.withdraw?.(result.organization_id);
      } catch {
        options.reportIntegrationError?.('accreditation withdrawal');
      }
      return result;
    },

    /**
     * Redeem a one-time organization invitation and create its operator account.
     *
     * @param input - Invitation, username, email and password fields.
     * @returns The registered organization and account identifiers.
     * @throws AccreditationError for invalid or expired invitations, registration fields or
     * username conflicts; database and password-hashing errors.
     */
    async register(input: Record<string, unknown>) {
      const parsed = registrationInput(input);
      if (parsed.fields) throw invalid(parsed.fields);
      const { invitation: code, username, password, kind } = parsed.value;
      if (!code) throw registrationRefused(404, 'InvalidInvitation');

      let registered: { id: string; account: number; kind: string } | undefined;
      const result = await transaction(database, async (client) => {
        const {
          rows: [organization],
        } = await client.query(
          `
          SELECT o.*, p.revoked_at AS parent_revoked_at, r.revoked_at AS root_revoked_at
          FROM accredited_organizations o
          LEFT JOIN accredited_organizations p ON p.id = o.parent_id
          LEFT JOIN accredited_organizations r ON r.id = p.parent_id
          WHERE o.invitation_digest = $1 AND o.account_id IS NULL
          FOR UPDATE OF o
        `,
          [invitationDigest(code)],
        );
        const now = Date.now();
        if (
          !organization ||
          [organization.invitation_expires_at].some((date) => date && date <= now)
        )
          throw registrationRefused(404, 'InvalidInvitation');
        if (kind && kind !== organization.kind) throw registrationRefused(409, 'WrongKind');
        if (
          [
            organization.accredited_until,
            organization.revoked_at,
            organization.parent_revoked_at,
            organization.root_revoked_at,
          ].some((date) => date && date <= now)
        )
          throw registrationRefused(404, 'InvalidInvitation');
        if (
          (
            await client.query('SELECT 1 FROM operator_accounts WHERE lower(username)=lower($1)', [
              username,
            ])
          ).rowCount
        )
          throw registrationRefused(409, 'UsernameTaken');

        const codes = passwordPolicyCodes(password as string, {
          username,
          email: organization.contact_email,
        });
        if (codes.length) throw registrationRefused(400, 'WeakPassword', codes.sort());
        const hash = await hashPassword(password as string);
        const {
          rows: [account],
        } = await client.query(
          `
          INSERT INTO operator_accounts (username, email, password_hash)
          VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id
        `,
          [username, organization.contact_email, hash],
        );
        if (!account) throw registrationRefused(409, 'UsernameTaken');

        await client.query('INSERT INTO operator_roles SELECT $1, unnest($2::text[])', [
          account.id,
          registrationRoles[organization.kind],
        ]);
        for (const role of registrationRoles[organization.kind]!) {
          const group = (
            await client.query<{ id: number }>(
              `INSERT INTO operator_groups(name) VALUES ($1)
            ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
              [role],
            )
          ).rows[0];
          await client.query(
            'INSERT INTO operator_account_groups(account_id,group_id) VALUES ($1,$2)',
            [account.id, group.id],
          );
        }
        await client.query(
          `
          UPDATE accredited_organizations SET account_id = $2, registered_at = now(),
            invitation_digest = NULL, invitation_expires_at = NULL
          WHERE id = $1
        `,
          [organization.id, account.id],
        );
        await record(client, 'organization_registered', organization.id, account.id);
        registered = { id: organization.id, account: account.id, kind: organization.kind };
        return { organization: organization.name, kind: organization.kind, username };
      });
      if (registered!.kind === 'ti') {
        try {
          await options.onboard?.(registered!.id, registered!.account);
        } catch {
          options.reportIntegrationError?.('issuer onboarding');
        }
      }
      return result;
    },
  };
}
