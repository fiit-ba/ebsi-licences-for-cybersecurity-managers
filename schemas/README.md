# Schemas for EBSI's pilot network

The JSON Schemas the Professional License Registry needs in EBSI's Trusted Schemas
Registry (TSR) on the pilot network. EBSI's Support Office registers them; nobody
registers a schema in the TSR directly.

## What to register

| Schema | What it validates | Pilot id |
|---|---|---|
| [`cybersecurity-manager-certificate/1.0.0`](cybersecurity-manager-certificate/1.0.0/schema.json) | The cybersecurity manager licence (`CybersecurityManagerCertificate`): its 15 attributes, with their labels (`title`), hints (`description`), defaults and which are required, in English. Extends EBSI's Verifiable Attestation (VCDM 1.1). | expected `z4eShNfMYyp35hFGgsngMPAwLKWjmWHiiBj4zLDZk7fqy`, or `zqu1owRqHYZBscJDRL3esWeFH2JrHwNuxHs7d9h9vbcJ` if the TSR also removes `default` (below) |
| [`certificate-status-entry/1.0.0`](certificate-status-entry/1.0.0/schema.json) | The licence's `credentialStatus`: one `PlrLedgerStatusEntry` naming the certificate registry contract that keeps its record. A type extension; it extends EBSI's Verifiable Attestation, as every EBSI schema must. | expected `z9pKTuKc7E8BFzj3ajMyru7ndpiZeXaLqwehMyBV4Dex7` |

[`cybersecurity-manager-certificate/1.0.0/example.json`](cybersecurity-manager-certificate/1.0.0/example.json)
is a complete licence with sample data. It is valid against both schemas, EBSI's
Verifiable Attestation and EBSI's `IssuanceCertificate` type extension, as they are
on the pilot today.

## What not to register

The trust chain's credentials use EBSI's own schemas, already on the pilot:

| Credential | EBSI schema | Pilot id |
|---|---|---|
| Base of every credential | EBSI Verifiable Attestation (VCDM 1.1) | `zH74MKkYTbQ6ZfTxufi6A3Aw8giS4piGm8dpgxFmkJjmu` (`0xef484394…c5ec`) |
| VerifiableAccreditationToAccredit, VerifiableAccreditationToAttest | EBSI Verifiable Accreditation Record | `zHXHLkJpZg4w9nt2GbEBbyE8uhkfirbmT3nF7mJ9kFnjv` |
| VerifiableAuthorisationToOnboard, VerifiableAuthorisationForTrustChain | EBSI Verifiable Authorisation | `zBE5cU4EGs5AABdrPRfMfGSZ63oMi6yet5gYTEKYmstAa` |
| `termsOfUse` of type `IssuanceCertificate` | EBSI type extension for use of IssuanceCertificate | `z2yw1Mq2Cq4jN8B2bJ66cGcFEqjrJQUinxHAUjZTkVKjz` |

These are the newest VCDM 1.1 versions on the pilot: the accreditation and
authorisation schemas are those built on that Verifiable Attestation. Confirm them
with the Support Office when submitting.

## How to submit

Following [Publish your schema](https://hub.ebsi.eu/docs/services/trust-chains-and-trusted-issuers/data-models/publish-schema),
the domain's representative sends the Support Office (support@europeum.eu):

- the data model template, describing each attribute;
- the JSON Schemas in this folder;
- an acknowledgement from the domain's representatives that the schema is recognised
  in the domain (for the cybersecurity manager licence, the National Security
  Authority);

and a representative adds the example credential (`example.json`) to EBSI's
[JSON Schema repository](https://ec.europa.eu/digital-building-blocks/code/projects/EBSI/repos/json-schema/browse)
by a pull request, named `EA-v3-{cluster name}-{name of the example}.json`; the
cluster name is agreed with the Support Office.

Both schemas meet the rules EBSI states: `$schema` is exactly
`https://json-schema.org/draft/2020-12/schema` (the registry refuses any other value),
and both extend EBSI's Verifiable Attestation, the status entry schema too although it
is a type extension (EBSI's own for `IssuanceCertificate` does not).

The TSR forms a schema's id itself, as the page above describes: it bundles the
schema with json-schema-ref-parser's `bundle()` (the referenced Verifiable Attestation
is inlined and its own `$ref`s point into it), removes its annotations (`title`,
`description`, `examples`), canonicalises it (JCS, RFC 8785), hashes it with SHA-256
and encodes the hash in multibase base58btc (`z…`); the hexadecimal form (`0x…`) is the
same hash. Bundling with json-schema-ref-parser 9 to 11 reproduces the ids of EBSI's
Verifiable Attestation, Verifiable Accreditation Record and Verifiable Authorisation;
version 16 bundles differently and gives other ids. The ids above were computed that
way. EBSI names the annotations only by example, and JSON Schema counts `default` as
one too: the licence schema has defaults, and its id is the second one if the TSR also
removes them. Fixing a label or a description keeps the id; any other change is a new
schema version, with a new id.

## After registration

The back-office reads the licence schema from the TSR by its id. On the pilot, in the hosted
installation's settings ([`infra/prod/env.example`](../infra/prod/env.example), from whose
`PLR_EBSI_API_ORIGIN` `docker-compose.prod.yml` sets the back-office's `PLR_EBSI_URL` and its
registry URLs):

```sh
PLR_EBSI_API_ORIGIN=https://api-pilot.ebsi.eu   # EBSI's pilot APIs (PLR_EBSI_API=pilot)
PLR_TSR_SCHEMAS=<the licence schema's id>
PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL=https://api-pilot.ebsi.eu/trusted-schemas-registry/v3/schemas/<the status entry schema's id>
```

What a licence carries follows EBSI's rules: `issued` is the instant it was signed (the
JWT's `iat`), `issuanceDate` is the same as `validFrom` (the JWT's `nbf`), and it has
exactly three `credentialSchema` entries: its own schema, the status entry's, and
EBSI's `IssuanceCertificate` type extension. A licence in any other form is refused. The back-office and the Wallet validate a schema together with the EBSI
schema it extends, which they read by its id from the configured TSR, and a
presentation may withhold the attributes the schema requires. The trust chain's
credentials name EBSI's schemas above.

The schemas are written in English. The console and the Wallet name a licence's
attributes with its schema's labels and hints, in both of their languages; they
keep no names of their own for attributes, so a schema registered later is shown
in its own words.

## In development

The development installation registers the same files in its own TSR:
`cybersecurity-manager-certificate` as `zPlrCybersecurityManagerV1`, the status entry
as `zPlrCertificateStatusEntryV4`, and copies of EBSI's schemas from
[`ebsi/`](ebsi) under their pilot ids. The back-office reads them from
`back-office/shared/schemas.json`, which `node back-office/scripts/sync-schemas.ts`
writes from this folder; CI fails when it is stale.
