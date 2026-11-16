import type { ServerResponse } from 'node:http';

/**
 * Write a no-store JSON response.
 *
 * @param response - Outgoing HTTP response.
 * @param status - HTTP status.
 * @param body - JSON-serializable response body.
 * @returns No return value.
 * @throws JSON serialization or response-stream errors.
 */
export function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

/**
 * Write a signed request object as OpenID4VP 1.0 and RFC 9101 have it: the compact JWT
 * itself, typed `application/oauth-authz-req+jwt`, never stored.
 *
 * @param response - Outgoing HTTP response.
 * @param jwt - The signed request object.
 * @returns No return value.
 * @throws Response-stream errors.
 */
export function sendRequestObject(response: ServerResponse, jwt: string) {
  response.writeHead(200, {
    'content-type': 'application/oauth-authz-req+jwt',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(jwt);
}
