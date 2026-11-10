import type { Pool } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { IssuanceError } from '../issuance/claims.ts';
import { issuerAttributes } from './registry.ts';

const defaultType = 'CybersecurityManagerCertificate';

/** Cached per-issuer, per-type accreditation result returned by the existing operator API. */
export interface AccreditationState {
  checked_at: string;
  schema_id: string;
  credential_type: string;
  issuer_did: string;
  accredited: boolean | null;
  confirmed_at: string | null;
  reason: string;
  unavailable?: boolean;
}

/**
 * Create persistent accreditation revalidation with the existing bounded outage grace period.
 * @param database - PostgreSQL pool.
 * @param options - Configured issuer/TIR/schema addresses and signed-chain validator.
 * @returns Cached state, forced revalidation, scheduled sweep and issuance guard.
 * @throws Error for invalid grace-period configuration; operations propagate database errors.
 */
export function postgresAccreditation(
  database: Pool,
  options: {
    issuerDid: string;
    tirUrl: string;
    schemaAddress: (id: string) => string;
    check: (
      did: string,
      type: string,
      context: { attribute?: string; schemaId?: string },
    ) => Promise<void>;
    fetchRegistry?: typeof fetch;
    maxAgeHours?: number;
    required?: boolean;
    defaultSchema?: string;
  },
) {
  const maxAge = (options.maxAgeHours ?? 72) * 3_600_000;
  if (!Number.isFinite(maxAge) || maxAge < 0)
    throw new Error('Invalid accreditation confirmation lifetime.');
  /**
   * Resolve a cached answer or freshly validate a missing/explicitly refreshed answer.
   * @param refresh - Whether to bypass the cached result.
   * @param type - Credential type, defaulting to the historical default type.
   * @param did - Issuer DID, defaulting to the registry issuer.
   * @returns Current trust result; transport failure preserves a prior confirmation, explicit distrust clears it.
   * @throws Database errors; registry/trust refusals are represented in the returned state.
   */
  async function state(
    refresh = false,
    type = defaultType,
    did = options.issuerDid,
  ): Promise<AccreditationState> {
    return transaction(database, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(651905,hashtext($1))', [did + '|' + type]);
      const previous: AccreditationState | undefined = (
        await client.query(
          'SELECT result FROM issuer_accreditation_checks WHERE issuer_did=$1 AND credential_type=$2',
          [did, type],
        )
      ).rows[0]?.result;
      if (previous && !refresh) return previous;
      const version = (
        await client.query(
          `SELECT v.tsr_id FROM certificate_schema_versions v JOIN certificate_schemas s ON s.id=v.schema_id
        WHERE s.credential_type=$1 AND registered_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
          [type],
        )
      ).rows[0];
      const result: AccreditationState = {
        checked_at: new Date().toISOString(),
        schema_id:
          type === defaultType && options.defaultSchema
            ? options.defaultSchema
            : version
              ? options.schemaAddress(version.tsr_id)
              : '',
        credential_type: type,
        issuer_did: did,
        accredited: null,
        confirmed_at: null,
        reason: '',
      };
      try {
        const attributes = await issuerAttributes(options.tirUrl, did, options.fetchRegistry);
        const attribute = attributes.find((item) => String(item.issuerType).toUpperCase() === 'TI');
        if (!attribute)
          throw new IssuanceError(
            409,
            'NotAccredited',
            'The issuer holds no attestation accreditation.',
          );
        await options.check(did, type, { attribute: attribute.id, schemaId: result.schema_id });
        result.accredited = true;
        result.confirmed_at = result.checked_at;
      } catch (error) {
        if (error instanceof IssuanceError && error.body.reason === 'NotAccredited') {
          result.accredited = false;
          result.reason = error.message;
        } else {
          result.accredited = previous?.accredited ?? null;
          result.confirmed_at = previous?.confirmed_at ?? null;
          // An outage cannot carry an old confirmation over to a new schema.
          if (previous) result.schema_id = previous.schema_id;
          result.reason = 'Revalidation could not complete: registry unavailable';
          result.unavailable = true;
        }
      }
      await client.query(
        `INSERT INTO issuer_accreditation_checks VALUES($1,$2,$3) ON CONFLICT(issuer_did,credential_type) DO UPDATE SET result=EXCLUDED.result`,
        [did, type, result],
      );
      return result;
    });
  }
  return {
    state,
    /**
     * Refresh the registry's published types and every live TI's currently granted types.
     * @param type - Optional type to refresh after a schema publication.
     * @returns Completion after all selected issuer/type pairs are checked.
     * @throws Database errors; trust outages are recorded as state results.
     */
    async revalidateAll(type?: string) {
      const { rows } = await database.query(
        `SELECT $1::text AS did,s.credential_type FROM certificate_schemas s WHERE ($2::text IS NULL OR s.credential_type=$2)
        UNION SELECT o.did,s.credential_type FROM accredited_organizations o JOIN organization_certificate_schemas g ON g.organization_id=o.id JOIN certificate_schemas s ON s.id=g.schema_id
        WHERE o.kind='ti' AND o.did IS NOT NULL AND o.revoked_at IS NULL AND ($2::text IS NULL OR s.credential_type=$2)
        UNION SELECT $1::text,'CybersecurityManagerCertificate' WHERE $2::text IS NULL`,
        [options.issuerDid, type ?? null],
      );
      for (const row of rows) await state(true, row.credential_type, row.did);
    },
    /**
     * Refuse issuance after explicit distrust or an expired last successful confirmation.
     * @param did - Issuer DID.
     * @param type - Credential type being issued.
     * @param context - Exact schema/attribute binding retained by the issuer interface.
     * @returns Completion while accreditation is confirmed recently enough, or when explicitly disabled.
     * @throws IssuanceError when untrusted/stale; database errors.
     */
    async ensureAccredited(
      did: string,
      type: string,
      context: { attribute?: string; schemaId?: string },
    ) {
      if (options.required === false) return;
      const current = await state(false, type, did);
      if (
        current.accredited === false ||
        !current.confirmed_at ||
        Date.now() - Date.parse(current.confirmed_at) > maxAge
      )
        throw new IssuanceError(
          409,
          'NotAccredited',
          current.reason || 'The issuer accreditation has not been confirmed recently enough.',
        );
      if (context.schemaId && current.schema_id !== context.schemaId)
        await options.check(did, type, context);
    },
  };
}
