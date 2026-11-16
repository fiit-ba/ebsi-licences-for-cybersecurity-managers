# EBSI integration profiles

Checked against official documentation on 2026-11-04. A configured endpoint is a
specific protocol profile; changing its hostname/path does not migrate its write
or authorisation protocol.

| Area                | Adapter (Core API v1)                                                                              | Validated against                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| DID resolution      | `/v1/did-registry/identifiers`: bounded current and historical reads, optional contract instance   | Development service over EBSI's DID Registry contract |
| Issuer/schema trust | `/v1/issuers-registry`, `/v1/schemas-registry` under configured trusted roots                      | Development service over EBSI's registry contracts    |
| Authorisation       | `/v1/auth`: OpenID4VP 1.0 with DCQL for a scoped token; a refused token is replaced once           | Development service                                   |
| Ledger writes       | `POST /v1/ledger`: KMS-signed transactions with a scoped token (`ledger:invoke` for the contracts) | Development service and anvil                         |
| Timestamp           | Durable commit/reveal intents with a secret salt and maturity reconciliation                       | EBSI's Timestamp contract on anvil                    |

Registry writes (DID and TIR publication in development, certificate records and
governance votes) are transactions sent through the Ledger API; timestamp
submission is commit/reveal with a salt and a maturity requirement, as Core v1 has
it. The timestamp access token is still an externally refreshed bearer file.
[Official migration guide](https://hub.ebsi.eu/api/migration-guide).

Core authorisation uses OpenID4VP 1.0 with DCQL, registry-specific scopes and a
JSON-object `vp_token`; the back-office obtains its tokens that way. The holder
Wallet uses the same OpenID4VP 1.0 profile to present to the back-office, and
OpenID4VCI 1.0 (`tx_code`, the Nonce Endpoint, `proofs`) to collect credentials.
A holder who declines answers with the OpenID4VP error response `access_denied`
(`state` and `error` through `direct_post`): the request ends at once with the
result status `declined`, for the console, mobile and relying-party readers alike.
It is the request's one answer, like a presentation, and needs a request object
that was fetched; other error codes are refused.
[Official access control](https://hub.ebsi.eu/api/access-control).

DID history reads use `valid-at`; a failed historical lookup never falls back to
the current document. `PLR_DIDR_URL` names the identifiers endpoint, and optional
`PLR_DIDR_CONTRACT` pins its contract instance. This option is passed to key
publication checks and runtime issuer-key resolution.
[Official DID document endpoint](https://hub.ebsi.eu/api/core/did-registry-get-identifier).

Credential verification resolves an issuer key at its signed issuance timestamp.
The credential finalizer therefore sets `issuanceDate` and JWT `iat` at signing,
after loading the authorized key, rather than copying the earlier offer's
registration date. Certificate validity bounds and ledger records keep their
existing independent meaning. Accreditation and historical status-list keys also
use their signed issuance timestamp when supplied by that credential.

The checks use the development EBSI service over EBSI's registry contracts on a
local ledger, AWS SDK fixtures and real cryptography. No live AWS key creation or
EBSI submission has been validated. Production cutover still requires checks
against EBSI's pilot, real IAM roles and the onboarding of the TAO and its TIs,
which stays manual.
