import { BlockList, isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint } from 'jose';
import { publicEcKey } from '../ebsi/did-registry.ts';
import { exchangeKey, sealExchange, openExchange } from './exchange-crypto.ts';
import { presentationHolder, presentationEvaluator } from './holder.ts';
import type { ExchangeCache } from './exchange-cache.ts';
import type { postgresVerificationRequests, VerificationOwner } from './requests.ts';
import type { PublicEcKey } from '../ebsi/did-registry.ts';
import type { PresentationOutcome } from './outcomes.ts';

/** Existing holder exchange invitation after URL/network/key validation. */
export interface ExchangeTarget {
  url: string;
  exchange_id: string;
  token: string;
  key: PublicEcKey;
}

/** Mandatory/optional disclosure names. */
export interface ExchangeFields {
  mandatory: string[];
  optional: string[];
}

/** Wallet-connection error with its existing HTTP reason. */
export class ExchangeError extends Error {
  readonly reason: string;
  /**
   * Create a holder exchange refusal.
   * @param reason - Machine-readable exchange error.
   * @param detail - public explanation.
   */
  constructor(reason: string, detail = reason) {
    super(detail);
    this.reason = reason;
  }
}

/** Default QueryByExample fields shared by existing console and Wallet verifiers. */
export const defaultExchangeFields: ExchangeFields = {
  mandatory: ['certificateTitle', 'holderName', 'certificateNumber', 'certificationBody'],
  optional: [
    'jobPosition',
    'trainingName',
    'trainingStart',
    'trainingEnd',
    'trainingDays',
    'teachingHours',
    'knowledgeStandard',
    'placeOfIssue',
    'issueDate',
    'signatory',
    'funding',
  ],
};

/**
 * Normalize the existing mandatory/optional request, preserving order.
 * @param value - Optional JSON fields object.
 * @returns At most 64 names per group, without repeated optional mandatory names.
 * @throws ExchangeError for invalid request shape or field names.
 */
export function exchangeFields(value: unknown): ExchangeFields {
  if (!value || (typeof value === 'object' && !Object.keys(value).length))
    return structuredClone(defaultExchangeFields);
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ExchangeError('invalid_request', 'fields must name mandatory and optional fields');
  const result: ExchangeFields = { mandatory: [], optional: [] };
  for (const kind of ['mandatory', 'optional'] as const) {
    const names = (value as Record<string, unknown>)[kind] || [];
    if (
      !Array.isArray(names) ||
      names.some((name) => typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
    )
      throw new ExchangeError('invalid_request', `${kind} must be a list of field names`);
    result[kind] = [...new Set(names)].slice(0, 64);
  }
  result.optional = result.optional.filter((name) => !result.mandatory.includes(name));
  return result;
}

/**
 * Restrict a wallet invitation to explicit numeric IP networks and its exchange port/path.
 * @param value - Scanned invitation object or JSON string.
 * @param networks - PLR_EXCHANGE_NETWORKS CIDR list.
 * @returns Validated target without private JWK fields.
 * @throws ExchangeError for invalid invitation, network, token or P-256 key.
 */
export function parseExchangeInvitation(value: unknown, networks: string): ExchangeTarget {
  let invitation: any;
  try {
    invitation = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new ExchangeError('invalid_invitation', "Not the QR code of a wallet's exchange");
  }
  if (!invitation || invitation.type !== 'PlrPresentationExchange' || invitation.v !== 1)
    throw new ExchangeError('invalid_invitation', "Not the QR code of a wallet's exchange");
  let url;
  try {
    url = new URL(invitation.url);
  } catch {
    throw new ExchangeError('invalid_invitation', 'Not an exchange URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const declared = /^http:\/\/(\[[^\]]+\]|[^:/?#]+):/
    .exec(String(invitation.url))?.[1]
    ?.replace(/^\[|\]$/g, '');
  if (!declared || !isIP(declared))
    throw new ExchangeError('invalid_invitation', 'The exchange is not named by an IP address');
  const family = isIP(host);
  if (!family)
    throw new ExchangeError('invalid_invitation', 'The exchange is not named by an IP address');
  const match = /^\/exchanges\/([A-Za-z0-9_-]{16,64})$/.exec(url.pathname);
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || !match)
    throw new ExchangeError('invalid_invitation', 'Not an exchange URL');
  if (!url.port || Number(url.port) < 1024)
    throw new ExchangeError('invalid_invitation', 'Not a port a wallet listens on');
  const allowed = new BlockList();
  for (const cidr of networks
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [address, length] = cidr.split('/');
    const version = isIP(address);
    if (!version) throw new Error('Invalid PLR_EXCHANGE_NETWORKS');
    allowed.addSubnet(
      address,
      length === undefined ? (version === 4 ? 32 : 128) : Number(length),
      version === 4 ? 'ipv4' : 'ipv6',
    );
  }
  if (!allowed.check(host, family === 4 ? 'ipv4' : 'ipv6'))
    throw new ExchangeError(
      'not_allowed',
      `${host} is outside the networks this verifier connects to`,
    );
  if (typeof invitation.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(invitation.token))
    throw new ExchangeError('invalid_invitation', 'The invitation carries no token');
  let key;
  try {
    key = publicEcKey(invitation.key, 'P-256');
  } catch {
    throw new ExchangeError('invalid_invitation', 'The invitation carries no P-256 key');
  }
  return { url: url.href, exchange_id: match[1], token: invitation.token, key };
}

/** transient exchange record; never stored in the relational database. */
interface ExchangeSession {
  key: string;
  target: ExchangeTarget;
  challenge: string;
  domain: string;
  fields: ExchangeFields;
  failures: number;
  answer?: any;
}

/**
 * Connect the existing encrypted holder-initiated VC-API exchange to result storage.
 * @param options - TTL cache, evaluator, request storage and permitted wallet networks.
 * @returns Existing start/poll operations; no native Wallet application is launched.
 */
export function holderExchange(options: {
  cache: ExchangeCache;
  requests: ReturnType<typeof postgresVerificationRequests>;
  verifyPresentation: ReturnType<typeof presentationEvaluator>;
  networks: string;
  timeoutSeconds?: number;
  fetchWallet?: typeof fetch;
}) {
  const {
    cache,
    requests,
    verifyPresentation,
    networks,
    timeoutSeconds = 30,
    fetchWallet = fetch,
  } = options;
  const sessionKey = (state: string) => 'plr:exchange:' + state;
  const finalKey = (state: string) => sessionKey(state) + ':final';

  /**
   * Access only the invitation's validated wallet address without redirects.
   * @param method - POST request or GET poll.
   * @param target - Validated wallet target.
   * @param body - Optional encrypted request envelope.
   * @returns Wallet HTTP response, with its body still owned by the caller.
   * @throws ExchangeError on transport failure or timeout.
   */
  async function send(method: string, target: ExchangeTarget, body?: object) {
    try {
      return await fetchWallet(target.url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: {
          Authorization: 'Bearer ' + target.token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // A closed port looks the same whether the phone left the network or its QR
      // code expired (it is valid for two minutes), so the message names both.
      throw new ExchangeError(
        'unreachable',
        "The holder's wallet cannot be reached. Is the phone on the same network, and is its QR code still valid (2 minutes)?",
      );
    }
  }

  /**
   * Read an encrypted answer up to the existing maximum.
   * @param response - Successful wallet HTTP response.
   * @returns Parsed answer object.
   * @throws Error for empty, oversized or invalid answers.
   */
  async function body(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No wallet answer');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 256 * 1024) {
          await reader.cancel();
          throw new Error('The answer is too large');
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Retain a terminal progress status while destroying ephemeral secrets.
   * @param state - Exchange request state.
   * @param status - Existing declined/expired/unreachable/failed status.
   * @returns The supplied status.
   * @throws Cache errors.
   */
  async function finish(state: string, status: string) {
    await cache.set(finalKey(state), status, 600);
    await cache.remove(sessionKey(state));
    return status;
  }

  /**
   * Deliver the QueryByExample request and create its owned polling state.
   * @param invitation - Holder's invitation as scanned by the existing consumer.
   * @param owner - Operator or relying party authorized to read the result.
   * @param verifierName - Name shown to the holder, truncated to 100 characters.
   * @param fields - Optional mandatory/optional field lists.
   * @returns State and five-minute expiry.
   * @throws ExchangeError on invalid invitation or refused/unreachable wallet; cache/database errors.
   */
  async function start(
    invitation: unknown,
    owner: VerificationOwner,
    verifierName: string,
    fields?: unknown,
  ) {
    const target = parseExchangeInvitation(invitation, networks);
    const asked = exchangeFields(fields);
    const mine = exchangeKey();
    const challenge = randomBytes(24).toString('base64url');
    const domain = 'urn:plr:verifier:' + (await calculateJwkThumbprint(mine.publicKey));
    const request = {
      query: [
        {
          type: 'QueryByExample',
          credentialQuery: {
            example: {
              type: [
                'VerifiableCredential',
                'VerifiableAttestation',
                'CybersecurityManagerCertificate',
              ],
            },
            'plr:mandatory': asked.mandatory,
            'plr:optional': asked.optional,
          },
        },
      ],
      challenge,
      domain,
      ...(verifierName
        ? { 'plr:verifier': { name: Array.from(verifierName).slice(0, 100).join('') } }
        : {}),
    };
    const response = await send('POST', target, {
      envelope: sealExchange(
        mine,
        target.key,
        target.exchange_id,
        'request',
        { verifiablePresentationRequest: request },
        true,
      ),
    });
    await response.body?.cancel();
    if ([404, 410].includes(response.status))
      throw new ExchangeError('expired', "The holder's exchange has closed");
    if (response.status !== 202)
      throw new ExchangeError('rejected', `The holder's wallet answered ${response.status}`);
    const created = await requests.create(owner, 300);
    const session: ExchangeSession = {
      key: mine.privateKey,
      target,
      challenge,
      domain,
      fields: asked,
      failures: 0,
    };
    await cache.set(sessionKey(created.state), JSON.stringify(session), 360);
    return created;
  }

  /**
   * Poll one wallet once under the distributed lock, then record its answer.
   * @param state - Already authorized request state.
   * @returns Progress, done, or undefined when no exchange cache entry remains.
   * @throws Cache/database errors; a cached encrypted answer allows retry after a database failure.
   */
  async function poll(state: string): Promise<string | undefined> {
    const final = await cache.get(finalKey(state));
    if (final) return final;
    const lock = sessionKey(state) + ':lock';
    const token = randomBytes(24).toString('base64url');
    if (!(await cache.add(lock, token, 360))) return 'pending';
    try {
      const raw = await cache.get(sessionKey(state));
      if (!raw) return;
      const session: ExchangeSession = JSON.parse(raw);
      if (!session.answer) {
        let response;
        try {
          response = await send('GET', session.target);
        } catch (error) {
          if (!(error instanceof ExchangeError)) throw error;
          if (++session.failures >= 5) return finish(state, 'unreachable');
          await cache.set(sessionKey(state), JSON.stringify(session), 360);
          return 'pending';
        }
        if (response.status !== 200) {
          await response.body?.cancel();
          if (response.status === 202) {
            if (session.failures) {
              session.failures = 0;
              await cache.set(sessionKey(state), JSON.stringify(session), 360);
            }
            return 'pending';
          }
          return finish(
            state,
            response.status === 403
              ? 'declined'
              : [404, 410].includes(response.status)
                ? 'expired'
                : 'failed',
          );
        }
        try {
          session.answer = await body(response);
        } catch {
          return finish(state, 'failed');
        }
        // Preserve only the encrypted envelope during the existing TTL. A wallet
        // serves it once; a later DB failure must not ask it for a lost answer.
        await cache.set(sessionKey(state), JSON.stringify(session), 360);
      }
      let presentation;
      try {
        presentation = openExchange(
          session.key,
          session.target.key,
          session.target.exchange_id,
          'response',
          session.answer.envelope,
        ).verifiablePresentation;
      } catch {
        return finish(state, 'failed');
      }
      let outcome: PresentationOutcome;
      if (
        presentation?.type !== 'EnvelopedVerifiablePresentation' ||
        typeof presentation.id !== 'string' ||
        !presentation.id.startsWith('data:application/jwt,')
      ) {
        outcome = {
          state: 'INDETERMINATE' as const,
          reason: "The holder's answer holds no presentation",
          acceptable: false,
          credential_types: [],
          checks: { presentation_valid: false },
          credentials: [],
        };
      } else {
        const vp = presentation.id.slice('data:application/jwt,'.length);
        const holder = await presentationHolder(vp, {
          nonce: session.challenge,
          audience: session.domain,
          maxAge: 300,
        });
        outcome = await verifyPresentation(vp, { presentationVerified: holder !== undefined });
        if (outcome.state === 'VALID') {
          const shown = (outcome.credentials ?? []).map((item) => item.attributes || {});
          const missing = session.fields.mandatory.filter((name) =>
            shown.some((attributes) => !Object.hasOwn(attributes, name)),
          );
          if (missing.length)
            outcome = {
              ...outcome,
              state: 'INDETERMINATE',
              reason:
                'The presentation does not show what the verifier requires: ' + missing.join(', '),
              acceptable: false,
              checks: { ...outcome.checks, presentation_valid: false },
            };
        }
      }
      await requests.record(state, outcome);
      await cache.remove(sessionKey(state));
      return 'done';
    } finally {
      await cache.release(lock, token);
    }
  }
  return { start, poll };
}
