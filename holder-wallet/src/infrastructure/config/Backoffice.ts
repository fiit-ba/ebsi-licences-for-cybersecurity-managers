// Where the registry's back-office is, for what the wallet asks it directly:
// the verifier (design decisions D14) and an organization's issuing (D15).
// Everything else the wallet follows from the URLs an offer or request names.

// BACKOFFICE_URL in .env, the shared TypeScript API origin; read at build time.
export const backofficeUrl = (): string => String(process.env.BACKOFFICE_URL ?? '').replace(/\/+$/, '')

/** Whether this build knows where the back-office is. */
export const isBackofficeConfigured = (): boolean => Boolean(backofficeUrl())

/** How long a request to the back-office may take: a holder on a slow
 * connection must not be refused for it (at least 30 s). */
export const TIMEOUT_MS = 30000
