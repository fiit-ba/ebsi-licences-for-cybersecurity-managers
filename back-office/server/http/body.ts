import type { IncomingMessage } from 'node:http';
import { maxPasswordBytes } from '../identity/auth/passwords.ts';

/** Default body limit shared by JSON requests and the token exchange form. */
export const maxJsonBytes = 4096;

/** Authentication request body bound, preserving long administrator-created passwords. */
export const maxLoginBytes = maxPasswordBytes;

/**
 * Read a bounded request body of the expected media type.
 *
 * @param request - Incoming HTTP request.
 * @param mediaType - Required content type.
 * @param maxBytes - Maximum body bytes.
 * @returns A text field containing the UTF-8 body, or an HTTP refusal result.
 * @throws Request stream errors; unsupported media types and oversized bodies return refusal
 * results.
 */
export async function readBody(request: IncomingMessage, mediaType: string, maxBytes: number) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== mediaType) {
    return { status: 415, body: { detail: `Expected ${mediaType}.` } };
  }

  const chunks = [];
  let size = 0;
  // Keep the stream alive long enough to return a 413.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      return { status: 413, body: { detail: 'Request body is too large.' } };
    }
    chunks.push(chunk);
  }

  return { text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Parse a bounded JSON object request body.
 *
 * @param request - Incoming HTTP request.
 * @param maxBytes - Maximum JSON body bytes.
 * @returns A successful body field containing the parsed object, or an HTTP refusal result.
 * @throws Request stream errors; malformed or unsupported input returns an HTTP refusal result.
 */
export async function jsonBody(request: IncomingMessage, maxBytes = maxJsonBytes) {
  const input = await readBody(request, 'application/json', maxBytes);
  if (input.status) return input;
  try {
    const body = JSON.parse(input.text!);
    if (body && typeof body === 'object' && !Array.isArray(body))
      return { status: undefined, body };
  } catch {
    // The caller needs a JSON object.
  }
  return { status: 400, body: { detail: 'Expected a JSON object.' } };
}
