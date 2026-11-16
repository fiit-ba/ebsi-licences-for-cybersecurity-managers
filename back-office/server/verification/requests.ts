import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { secretDigest } from '../issuance/protection.ts';
import type { Protection } from '../issuance/protection.ts';
import type { PresentationOutcome } from './outcomes.ts';
import type { DcqlQuery } from './dcql.ts';

/** Exactly one result reader: authenticated operator, relying party or mobile bearer. */
export type VerificationOwner = { operator: number } | { party: string } | { mobile: string };

/** A verify flow and the DCQL query it asks with (OpenID4VP 1.0), from bootstrap configuration. */
export interface VerificationFlow {
  id: string;
  scope: string;
  response_type: string;
  dcql: DcqlQuery | null;
}

/**
 * Keep request/result ownership and encrypted, independently expiring attributes.
 * @param database - PostgreSQL pool/query executor.
 * @param protection - Existing encryption-at-rest adapter.
 * @param minutes - PLR_PRESENTATION_ATTRIBUTES_MINUTES value.
 * @returns Flow/request, result and retention operations without storing presentations or holders.
 * @throws Error for an invalid retention setting.
 */
export function postgresVerificationRequests(
  database: Pick<Pool, 'query'>,
  protection: Protection,
  minutes = 15,
) {
  if (!Number.isSafeInteger(minutes) || minutes < 0)
    throw new Error('Invalid presentation attribute retention.');

  /**
   * Read a configured verify flow by its scope or public UUID.
   * @param value - Scope or flow identifier.
   * @returns Flow and its DCQL query, or undefined when absent.
   * @throws Database query errors.
   */
  async function flow(value: string): Promise<VerificationFlow | undefined> {
    const {
      rows: [row],
    } = await database.query(
      `
      SELECT f.id,f.scope,f.response_type,d.dcql_query AS dcql
      FROM verify_flows f LEFT JOIN presentation_definitions d ON d.id=f.presentation_definition_id
      WHERE f.scope=$1 OR f.id::text=$1
    `,
      [value],
    );
    return row;
  }

  /**
   * Allocate an existing request with one authorized result reader.
   * @param owner - Request's operator, party or raw mobile read bearer.
   * @param seconds - Existing request/exchange lifetime.
   * @returns Opaque state and database-derived expiry.
   * @throws Database query errors.
   */
  async function create(owner: VerificationOwner, seconds = 600) {
    const state = randomBytes(18).toString('base64url');
    const {
      rows: [row],
    } = await database.query(
      `
      INSERT INTO presentation_requests(state,owner_id,relying_party_id,read_token_digest,expires_at)
      VALUES($1,$2,$3,$4,statement_timestamp()+$5*interval '1 second') RETURNING expires_at
    `,
      [
        state,
        'operator' in owner ? owner.operator : null,
        'party' in owner ? owner.party : null,
        'mobile' in owner ? secretDigest(owner.mobile) : null,
        seconds,
      ],
    );
    return { state, expires_at: row.expires_at as Date };
  }

  /**
   * Check exact result ownership before polling a wallet or opening attributes.
   * @param state - Public QR state.
   * @param owner - Authenticated principal or mobile read bearer.
   * @returns The owned request or undefined with indistinguishable wrong-owner/missing behavior.
   * @throws Database query errors.
   */
  async function owned(state: string, owner: VerificationOwner) {
    const {
      rows: [row],
    } = await database.query(`SELECT * FROM presentation_requests WHERE state=$1`, [state]);
    if (!row) return;
    if ('operator' in owner && row.owner_id === owner.operator) return row;
    if ('party' in owner && row.relying_party_id === owner.party) return row;
    if (
      'mobile' in owner &&
      owner.mobile &&
      row.read_token_digest &&
      timingSafeEqual(row.read_token_digest, secretDigest(owner.mobile))
    )
      return row;
  }

  /**
   * Record one outcome atomically; a repeated callback cannot overwrite it.
   * @param state - Known state.
   * @param outcome - Verified outcome and per-credential evidence/attributes.
   * @param client - Optional challenge-consumption transaction.
   * @returns Whether this call inserted the terminal result.
   * @throws Encryption or database errors; no partial result is committed.
   * @remarks The first terminal result wins; repeated callbacks cannot replace its evidence.
   */
  async function record(
    state: string,
    outcome: PresentationOutcome,
    client: Pick<PoolClient, 'query'> = database,
  ) {
    const credentials = outcome.credentials ?? [];
    const attributes = credentials.map((item) => item.attributes || {});
    const encrypted = attributes.some((item) => Object.keys(item).length)
      ? await protection.seal('presentation:' + state, attributes)
      : null;
    const { rowCount } = await client.query(
      `
      INSERT INTO presentation_results(state,verified,outcome,detail,credential_types,checks,evidence,attributes_encrypted,attributes_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::bytea IS NOT NULL THEN statement_timestamp()+$9*interval '1 minute' END)
      ON CONFLICT(state) DO NOTHING
    `,
      [
        state,
        outcome.acceptable,
        outcome.state,
        Array.from(outcome.reason).slice(0, 500).join(''),
        JSON.stringify(outcome.credential_types),
        JSON.stringify(outcome.checks ?? {}),
        JSON.stringify(credentials.map(({ attributes: _attributes, ...evidence }) => evidence)),
        encrypted,
        minutes,
      ],
    );
    return rowCount === 1;
  }

  /**
   * Record that the holder declined (OpenID4VP 1.0 error response access_denied).
   * @param state - Known state.
   * @param client - Challenge-consumption transaction.
   * @returns Whether this call inserted the terminal result.
   * @throws Database errors.
   * @remarks The first terminal result wins, as for presentations: a decline cannot
   * replace a recorded verification, nor a later presentation the decline.
   */
  async function decline(state: string, client: Pick<PoolClient, 'query'> = database) {
    const { rowCount } = await client.query(
      `INSERT INTO presentation_results(state,verified,outcome,detail) VALUES($1,false,'DECLINED','access_denied')
       ON CONFLICT(state) DO NOTHING`,
      [state],
    );
    return rowCount === 1;
  }

  /**
   * Project console/mobile fields, clearing attributes at their retention deadline.
   * @param state - Already authorized request state.
   * @returns Result shape, or undefined until it is recorded.
   * @throws Database or decryption errors.
   */
  async function result(state: string) {
    const {
      rows: [row],
    } = await database.query(
      `
      SELECT *,CASE WHEN attributes_until>statement_timestamp() THEN attributes_encrypted END AS retained
      FROM presentation_results WHERE state=$1
    `,
      [state],
    );
    if (!row) return;
    // Declined in the wallet: no verification, the same status as a declined exchange.
    if (row.outcome === 'DECLINED')
      return { status: 'declined' as const, created_at: row.created_at as Date };
    const attributes = row.retained
      ? await protection.open('presentation:' + state, row.retained)
      : [];
    const credentials = row.evidence.map((item: any, index: number) => ({
      ...item,
      attributes: attributes[index] ?? null,
    }));
    return {
      status: 'done' as const,
      verified: row.verified as boolean,
      outcome: row.outcome as string,
      detail: row.detail as string,
      credential_types: row.credential_types as string[],
      checks: row.checks,
      credentials,
      attributes_until: credentials.some(
        (item: any) => item.attributes && Object.keys(item.attributes).length,
      )
        ? row.attributes_until
        : null,
      created_at: row.created_at as Date,
    };
  }

  /**
   * Erase expired ciphertext and spent/expired nonce state while retaining public evidence.
   * @returns Number of attribute rows purged.
   * @throws Database errors.
   */
  async function purgeAttributes() {
    const { rowCount } = await database.query(
      `UPDATE presentation_results SET attributes_encrypted=NULL,attributes_until=NULL WHERE attributes_until<=statement_timestamp() AND attributes_encrypted IS NOT NULL`,
    );
    await database.query(
      'DELETE FROM presentation_challenges WHERE expires_at<=statement_timestamp()',
    );
    return rowCount;
  }
  return { flow, create, owned, record, decline, result, purgeAttributes };
}
