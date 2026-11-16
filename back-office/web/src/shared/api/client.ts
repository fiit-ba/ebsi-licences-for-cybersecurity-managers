// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

/**
 * Clients for systems the console talks to.
 *
 * Everything goes through Vite's dev proxy so the browser sees one origin.
 */

import { fieldErrors, serverMessage, t } from '../i18n/index.ts';
import { SESSION_EXPIRED, accessToken, signOut } from './session.ts';

const BACKEND = '/api-backend';
// At least 30 s: a slow connection that does answer must not be cut off.
const REQUEST_TIMEOUT_MS = 30000;

/** Existing JSON request method, body, bearer-authentication and timeout controls. */
type RequestOptions = { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number };

/** HTTP refusal carrying the same public fields as the original operator client. */
type RequestFailure = Error & {
  reason?: string;
  status?: number;
  payload?: Record<string, unknown>;
};

/**
 * Collapse whitespace in a backend text refusal before displaying it.
 * @param text - Text to normalize or translate.
 * @returns The whitespace-normalized text.
 */
function compact(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the existing readable summary from a text or HTML backend refusal.
 * @param payload - Existing JSON payload required by the selected backend endpoint.
 * @param status - Existing HTTP or holder-exchange status.
 * @returns The readable text/HTML refusal, or an empty string for a non-text payload.
 */
function textError(payload, status) {
  if (typeof payload !== 'string') return '';
  const title = payload.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (title) {
    return t('Backend vrátil chybovú stránku: {0}', [compact(title)]);
  }
  if (/^\s*</.test(payload)) {
    return t('Backend vrátil HTML chybovú stránku (HTTP {0}).', [status]);
  }
  return compact(payload).slice(0, 200);
}

/**
 * Read the backend response as JSON when possible, otherwise retain its original text.
 * @param response - Fetch response received from the backend.
 * @returns The parsed JSON, null for an empty response, or the original non-JSON text.
 */
async function readPayload(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/**
 * Serialize the existing JSON request body while preserving an omitted body.
 * @param body - Existing JSON request body.
 * @returns The serialized JSON, or undefined when the body was omitted.
 * @throws JSON serialization errors for unsupported or circular values.
 */
function requestBody(body) {
  return body === undefined ? undefined : JSON.stringify(body);
}

/**
 * Create the existing localized backend-timeout error.
 * @returns A localized Error for the existing backend timeout.
 */
function timeoutError() {
  return new Error(t('Backend neodpovedá. Skontrolujte, či je MVP spustené, a skúste to znova.'));
}

/**
 * Send a request with the existing timeout and always clear its abort timer.
 * @param url - Request URL.
 * @param options - Existing request, component or routing options.
 * @param timeoutMs - Existing request timeout in milliseconds.
 * @returns The original Fetch response.
 * @throws The existing localized timeout error, HTTP refusal or underlying network error.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send the existing same-origin backend request and preserve session-expiry and refusal handling.
 * @param path - Existing backend path below the same-origin API prefix.
 * @param fields - Existing operation inputs: {method = 'GET', body, auth = true, timeoutMs = REQUEST_TIMEOUT_MS}.
 * @returns The successful parsed backend payload using the existing JSON-or-text response handling.
 * @throws The existing localized timeout error, HTTP refusal or underlying network error.
 */
export async function backendRequest(path: string, fields: RequestOptions = {}) {
  const { method = 'GET', body, auth = true, timeoutMs = REQUEST_TIMEOUT_MS } = fields;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = accessToken();
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(
    `${BACKEND}${path}`,
    {
      method,
      headers,
      body: requestBody(body),
      // The API router appends a trailing slash and answers 301 without one;
      // following it keeps the method on POST.
      redirect: 'follow',
    },
    timeoutMs,
  );

  const payload = await readPayload(response);

  // Match the error code: this API reports session expiry as 403 rather than
  // 401 here, so a status check would silently never fire.
  if (payload && payload.code === 'token_not_valid') {
    signOut();
    window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new Error(t('Relácia vypršala. Prihláste sa znova.'));
  }

  // The organization's accreditation was revoked (design decisions D24): the
  // back-office refuses its token from then on. Signed out, and told why.
  if (auth && token && payload && payload.reason === 'AccreditationRevoked') {
    signOut();
    const message = serverMessage(payload.detail);
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED, { detail: { message } }));
    const error: RequestFailure = new Error(message);
    error.reason = payload.reason;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (!response.ok) {
    const detail =
      (payload && (payload.detail || payload.error || payload.message)) ||
      fieldErrors(payload) ||
      textError(payload, response.status) ||
      `HTTP ${response.status}`;
    const error: RequestFailure = new Error(serverMessage(detail));
    error.reason = (payload && payload.reason) || '';
    error.status = response.status;
    error.payload = payload && typeof payload === 'object' ? payload : {};
    throw error;
  }

  return payload;
}
