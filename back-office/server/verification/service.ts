import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from '../adapters/transaction.ts';
import { postgresVerificationRequests } from './requests.ts';
import type { VerificationOwner } from './requests.ts';
import { credentialEvaluator } from './evaluate.ts';
import type { EvaluationOptions } from './evaluate.ts';
import { presentationEvaluator, presentationHolder } from './holder.ts';
import { unverified } from './outcomes.ts';
import { matchesDcql, parseVpToken } from './dcql.ts';
import { presentationAdmission } from './presentation-admission.ts';
import { holderExchange } from './exchange.ts';
import type { ExchangeCache } from './exchange-cache.ts';
import type { AuthorizationSigning } from '../issuance/types.ts';
import type { Protection } from '../issuance/protection.ts';

/** Existing verifier API refusal with the public detail and status. */
export class VerifierApiError extends Error {
  readonly status: number;
  /**
   * Create a protocol-compatible API refusal.
   * @param status - Existing HTTP status.
   * @param detail - Public explanation.
   */
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

/**
 * Compose the existing console, external and mobile verification workflows.
 * @param database - PostgreSQL pool used for atomic callback/result completion.
 * @param options - Read-only verification dependencies, registry request signer, TTL cache and public origin.
 * @returns Offer/request/submit/result/exchange operations.
 */
export function verificationService(
  database: Pool,
  options: EvaluationOptions & {
    protection: Protection;
    signing: AuthorizationSigning;
    cache: ExchangeCache;
    origin: string;
    attributesMinutes?: number;
    exchangeNetworks: string;
    exchangeTimeoutSeconds?: number;
  },
) {
  const requests = postgresVerificationRequests(
    database,
    options.protection,
    options.attributesMinutes,
  );
  const verifyCredential = credentialEvaluator(options);
  const verifyPresentation = presentationEvaluator(verifyCredential);
  const exchange = holderExchange({
    cache: options.cache,
    requests,
    verifyPresentation,
    networks: options.exchangeNetworks,
    timeoutSeconds: options.exchangeTimeoutSeconds,
  });
  const origin = new URL(options.origin).origin;
  const defaultScope = 'plr-verify-cybersecurity-manager';

  /**
   * The verifier's OpenID4VP 1.0 Client Identifier: the registry's DID, with a request object it
   * signs with that DID's assertion key.
   * @returns `decentralized_identifier:<did>`.
   * @throws Error when no registry DID is configured.
   */
  function clientId() {
    if (!options.signing.did) throw new Error('Configure the registry DID that signs requests.');
    return 'decentralized_identifier:' + options.signing.did;
  }

  /**
   * Mint an OpenID4VP 1.0 request by reference and its owned ten-minute polling state.
   * @param owner - Exact operator/party/mobile result reader.
   * @param scope - Existing configured VerifyFlow scope.
   * @returns The `openid4vp://` invocation URI, state and expiry.
   * @throws VerifierApiError for missing/unusable flows; database errors.
   */
  async function offer(owner: VerificationOwner, scope = defaultScope) {
    const flow = await requests.flow(scope);
    if (!flow) throw new VerifierApiError(404, `No verify flow named ${scope}`);
    if (!flow.dcql || flow.response_type !== 'vp_token')
      throw new VerifierApiError(409, 'Could not build the request');
    const created = await requests.create(owner);
    const uri = origin + '/' + flow.id + '/presentation-offer?state=' + created.state;
    return {
      ...created,
      request_uri:
        'openid4vp://?client_id=' +
        encodeURIComponent(clientId()) +
        '&request_uri=' +
        encodeURIComponent(uri),
    };
  }

  /**
   * Sign the request object a wallet fetches by reference, recording its one-time nonce.
   * @param flowId - Verify flow UUID.
   * @param state - Request state.
   * @returns The `oauth-authz-req+jwt` request object, or undefined for an unknown/used request.
   * @throws KMS, signing or database errors.
   */
  async function requestObject(flowId: string, state: string) {
    const flow = await requests.flow(flowId);
    if (!flow?.dcql || flow.response_type !== 'vp_token') return;
    const {
      rows: [request],
    } = await database.query(
      `SELECT expires_at FROM presentation_requests WHERE state=$1 AND expires_at>statement_timestamp() AND NOT EXISTS(SELECT 1 FROM presentation_results WHERE state=$1)`,
      [state],
    );
    if (!request) return;
    const nonce = randomUUID();
    const audience = clientId();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      aud: 'https://self-issued.me/v2',
      client_id: audience,
      iat: now,
      exp: now + 600,
      response_type: 'vp_token',
      response_mode: 'direct_post',
      response_uri: origin + '/auth/direct_post',
      nonce,
      state,
      dcql_query: flow.dcql,
      client_metadata: {
        client_name: 'Atest',
        vp_formats_supported: { jwt_vc_json: { alg_values: ['ES256'] } },
      },
    };
    // A decentralized_identifier client signs with a key its DID document holds.
    const key = await options.signing.key();
    const input = Buffer.from(
      [
        JSON.stringify({ alg: 'ES256', typ: 'oauth-authz-req+jwt', kid: key.kid }),
        JSON.stringify(payload),
      ]
        .map((part) => Buffer.from(part).toString('base64url'))
        .join('.'),
    );
    const signature = await key.sign(input);
    await database.query(
      `INSERT INTO presentation_challenges(nonce,state,flow_scope,audience,expires_at) VALUES($1,$2,$3,$4,$5)`,
      [nonce, state, flow.scope, audience, request.expires_at],
    );
    return input.toString() + '.' + Buffer.from(signature).toString('base64url');
  }

  /**
   * Verify an OpenID4VP 1.0 direct_post response once and record its outcome.
   * @param input - Form fields: `state` and the JSON `vp_token`.
   * @returns Whether the presentation was acceptable; false for unknown, spent or malformed ones.
   * @throws Database, KMS or provider errors.
   */
  async function submit(input: Record<string, string>) {
    const { state } = input;
    const vpToken = parseVpToken(input.vp_token);
    if (!vpToken || typeof state !== 'string') return false;
    // This verifier's queries ask for one presentation of one credential.
    const presented = Object.values(vpToken).flat();
    if (presented.length !== 1) return false;
    const vp = presented[0];
    let nonce;
    try {
      nonce = unverified(vp).payload.nonce;
    } catch {
      return false;
    }
    if (typeof nonce !== 'string') return false;
    const {
      rows: [challenge],
    } = await database.query(
      `SELECT * FROM presentation_challenges WHERE nonce=$1 AND state=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,
      [nonce, state],
    );
    if (!challenge) return false;
    // Network reads and local certification-body lookups must not retain pool
    // clients: simultaneous submits could otherwise exhaust the whole pool.
    const holder = await presentationHolder(vp, { nonce, audience: challenge.audience });
    const flow = await requests.flow(challenge.flow_scope);
    const envelope = Boolean(
      holder &&
      flow &&
      matchesDcql(vpToken, flow.dcql) &&
      (await presentationAdmission(vp, options.registry)),
    );
    let outcome = await verifyPresentation(vp);
    if (!envelope && outcome.state === 'VALID')
      outcome = await verifyPresentation(vp, { fresh: true });
    if (!envelope && outcome.state === 'VALID')
      outcome = {
        ...outcome,
        state: 'INDETERMINATE',
        reason: 'The presentation did not pass verification',
        checks: { ...outcome.checks, presentation_valid: false },
      };
    outcome.acceptable &&= envelope;
    if (!envelope) for (const credential of outcome.credentials ?? []) credential.attributes = {};
    return transaction(database, async (client) => {
      // Serialize on the request, including different nonce objects retrieved
      // for the same QR, and keep the result and consumed nonce in one commit.
      const {
        rows: [request],
      } = await client.query('SELECT state FROM presentation_requests WHERE state=$1 FOR UPDATE', [
        state,
      ]);
      if (!request) return false;
      const {
        rows: [challenge],
      } = await client.query(
        `SELECT * FROM presentation_challenges WHERE nonce=$1 AND state=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
        [nonce, state],
      );
      if (
        !challenge ||
        (await client.query('SELECT 1 FROM presentation_results WHERE state=$1', [state])).rowCount
      )
        return false;
      await requests.record(state, outcome, client);
      await client.query(
        'UPDATE presentation_challenges SET consumed_at=clock_timestamp() WHERE nonce=$1',
        [nonce],
      );
      return outcome.acceptable;
    });
  }

  /**
   * Record a holder's refusal: an OpenID4VP 1.0 error response through direct_post.
   * @param input - Form fields: `state` and `error`.
   * @returns Whether it ended a live request; false for other errors, unknown,
   * expired or already answered requests, or one whose request object was never fetched.
   * @throws Database errors.
   * @remarks Only `access_denied`, the refusal this wallet sends. Like a presentation it
   * is the request's one answer: its nonces are spent and nothing replaces it.
   */
  async function decline(input: Record<string, string>) {
    const { state, error } = input;
    if (error !== 'access_denied' || typeof state !== 'string' || state.length > 255) return false;
    return transaction(database, async (client) => {
      const {
        rows: [request],
      } = await client.query(
        'SELECT state FROM presentation_requests WHERE state=$1 AND expires_at>clock_timestamp() FOR UPDATE',
        [state],
      );
      if (!request) return false;
      // A wallet that read the request: its request object was fetched and not yet answered.
      const { rowCount } = await client.query(
        `UPDATE presentation_challenges SET consumed_at=clock_timestamp()
         WHERE state=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,
        [state],
      );
      if (!rowCount) return false;
      return requests.decline(state, client);
    });
  }

  /**
   * Read an owned result, asking a holder exchange at most once per poll.
   * @param state - QR/poll state.
   * @param owner - Exact authenticated reader.
   * @returns Progress or completed console/mobile result and request expiry.
   * @throws VerifierApiError for unknown/foreign requests; cache/database errors.
   */
  async function read(state: string, owner: VerificationOwner) {
    const request = await requests.owned(state, owner);
    if (!request) throw new VerifierApiError(404, 'Unknown request');
    let result = await requests.result(state);
    if (result) return result;
    if (!('mobile' in owner)) {
      const progress = await exchange.poll(state);
      if (progress === 'done') result = await requests.result(state);
      else if (progress) return { status: progress };
    }
    if (result) return result;
    return {
      status: request.expires_at <= new Date() ? 'expired' : 'pending',
      expires_at: request.expires_at,
    };
  }
  return {
    offer,
    requestObject,
    submit,
    decline,
    read,
    exchange,
    verifyCredential,
    purgeAttributes: requests.purgeAttributes,
    mobileToken: () => randomBytes(32).toString('base64url'),
  };
}
