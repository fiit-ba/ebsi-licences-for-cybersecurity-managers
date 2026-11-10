import type { IncomingMessage, ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { jsonBody, readBody } from '../http/body.ts';
import { send, sendRequestObject } from '../http/response.ts';
import { clientAddress } from '../http/client-address.ts';
import { ExchangeError } from './exchange.ts';
import { VerifierApiError } from './service.ts';
import type { verificationService } from './service.ts';
import type { postgresRelyingParties } from './parties.ts';
import type { VerificationOwner } from './requests.ts';

/**
 * Project exchange/start errors without changing their reason or HTTP category.
 * @param error - Exchange transport/refusal or verifier API error.
 * @returns Status and JSON body, or undefined for an infrastructure failure.
 */
export function verifierRefusal(error: unknown) {
  if (error instanceof ExchangeError)
    return {
      status:
        ({ unreachable: 502, expired: 410, rejected: 502 } as Record<string, number>)[
          error.reason
        ] ?? 400,
      body: { detail: error.message, reason: error.reason },
    };
  if (error instanceof VerifierApiError)
    return { status: error.status, body: { detail: error.message } };
}

/**
 * Expose the external/mobile verifier and Wallet protocol routes.
 * @param service - Existing verification workflows.
 * @param options - API-key authentication, distributed limits and feature/proxy settings.
 * @returns A public HTTP dispatcher returning false for unrelated routes.
 */
export function verificationHttp(
  service: ReturnType<typeof verificationService>,
  options: {
    parties: ReturnType<typeof postgresRelyingParties>;
    partyThrottle: (key: string) => Promise<number | null>;
    mobileThrottle: (key: string) => Promise<number | null>;
    mobileEnabled?: boolean;
    trustedProxyHops?: number;
  },
) {
  /**
   * Serve a public verifier request without accepting operator JWTs as API keys.
   * @param request - Incoming request.
   * @param response - Outgoing JSON/protocol response.
   * @param path - Parsed pathname.
   * @returns Whether this dispatcher handled the route.
   * @throws Infrastructure errors; the outer HTTP boundary reports them without sensitive contents.
   */
  return async function publicHttp(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ) {
    const object = /^\/([0-9a-f-]{36})\/presentation-offer\/?$/.exec(path);
    if (object && request.method === 'GET') {
      const state =
        new URL(request.url!, 'http://back-office.invalid').searchParams.get('state') ?? '';
      const jwt = await service.requestObject(object[1], state);
      if (jwt) sendRequestObject(response, jwt);
      else send(response, 404, { detail: 'Not found.' });
      return true;
    }
    if (path === '/auth/direct_post' && request.method === 'POST') {
      const body = await readBody(request, 'application/x-www-form-urlencoded', 768 * 1024);
      if (body.status) {
        send(response, body.status, { error: 'invalid_request' });
        return true;
      }
      const params = new URLSearchParams(body.text);
      // OpenID4VP 1.0 error response: the holder declined (access_denied), so the
      // verifier stops waiting instead of letting the request expire.
      if (params.has('error')) {
        const declined =
          ['state', 'error'].every((name) => params.getAll(name).length === 1) &&
          !params.has('vp_token') &&
          (await service.decline(Object.fromEntries(params)));
        send(response, declined ? 200 : 400, declined ? {} : { error: 'invalid_request' });
        return true;
      }
      // OpenID4VP 1.0: state and a JSON vp_token; a presentation_submission is the draft's.
      if (
        ['state', 'vp_token'].some((name) => params.getAll(name).length !== 1) ||
        params.has('presentation_submission')
      ) {
        send(response, 400, { error: 'invalid_request' });
        return true;
      }
      const accepted = await service.submit(Object.fromEntries(params));
      send(response, accepted ? 200 : 400, accepted ? {} : { error: 'invalid_request' });
      return true;
    }
    if (!path.startsWith('/verifier/v1/')) return false;
    try {
      const mobile = path.startsWith('/verifier/v1/mobile/');
      let owner: VerificationOwner;
      let name = '';
      if (mobile) {
        if (options.mobileEnabled === false) {
          send(response, 404, { detail: 'Not found.' });
          return true;
        }
        const header = request.headers['x-plr-read-token'];
        owner = { mobile: typeof header === 'string' ? header : '' };
      } else {
        const party = await options.parties.authenticate(request.headers.authorization);
        if (!party) {
          response.setHeader('WWW-Authenticate', 'ApiKey');
          send(response, 401, {
            detail: request.headers.authorization?.startsWith('ApiKey ')
              ? 'Unknown or revoked API key'
              : 'Authentication credentials were not provided.',
          });
          return true;
        }
        owner = { party: party.id };
        name = party.name;
        const retry = await options.partyThrottle(party.id);
        if (retry) {
          response.setHeader('Retry-After', retry);
          send(response, 429, {
            detail: `Request was throttled. Expected available in ${retry} seconds.`,
          });
          return true;
        }
      }
      const prefix = '/verifier/v1/' + (mobile ? 'mobile/' : '');
      if (path === prefix + 'presentation-requests/' && request.method === 'POST') {
        if (mobile) {
          const retry = await options.mobileThrottle(
            clientAddress(request, options.trustedProxyHops),
          );
          if (retry) {
            response.setHeader('Retry-After', retry);
            send(response, 429, {
              detail: `Request was throttled. Expected available in ${retry} seconds.`,
            });
            return true;
          }
        }
        const input = await jsonBody(request);
        if (input.status) {
          send(response, input.status, input.body);
          return true;
        }
        const token = mobile ? service.mobileToken() : undefined;
        const created = await service.offer(
          token ? { mobile: token } : owner,
          mobile ? undefined : String(input.body.scope || 'plr-verify-cybersecurity-manager'),
        );
        send(response, 201, {
          ...created,
          ...(token ? { qr: await QRCode.toDataURL(created.request_uri), read_token: token } : {}),
        });
        return true;
      }
      const state = new RegExp('^' + prefix + 'presentation-requests/([\\w-]+)/$').exec(path)?.[1];
      if (state && request.method === 'GET') {
        const result = await service.read(state, owner);
        if (mobile) send(response, 200, result);
        else if (!('outcome' in result)) send(response, 200, { state, status: result.status });
        else
          send(response, 200, {
            state,
            status: 'done',
            result: result.outcome,
            acceptable: result.verified,
            reason: result.detail,
            checks: result.checks,
            credential_types: result.credential_types,
            credentials: result.credentials,
            presented_at: result.created_at,
          });
        return true;
      }
      if (!mobile && path === prefix + 'exchanges/' && request.method === 'POST') {
        const input = await jsonBody(request, 96 * 1024);
        if (input.status) send(response, input.status, input.body);
        else
          send(
            response,
            201,
            await service.exchange.start(input.body.invitation, owner, name, input.body.fields),
          );
        return true;
      }
      if (!mobile && path === prefix + 'credentials/verify/' && request.method === 'POST') {
        const input = await jsonBody(request, 96 * 1024);
        if (input.status) {
          send(response, input.status, input.body);
          return true;
        }
        const token = input.body.credential;
        if (typeof token !== 'string' || token.split('.').length !== 3 || token.length > 64 * 1024)
          send(response, 400, { detail: 'credential must be a compact JWT' });
        else send(response, 200, await service.verifyCredential(token));
        return true;
      }
      send(response, 404, { detail: 'Not found.' });
    } catch (error) {
      const refusal = verifierRefusal(error);
      if (!refusal) throw error;
      send(response, refusal.status, refusal.body);
    }
    return true;
  };
}
