# Schemas for EBSI's pilot network

The JSON Schemas the Professional Licence Registry needs in EBSI's Schemas Registry on the
pilot network (Core API v1). EBSI's Support Office registers them; nobody registers a schema
in the registry directly.

## What to register

| Schema | What it validates | Schema id |
|---|---|---|
| [`cybersecurity-manager-licence/1.0.0`](cybersecurity-manager-licence/1.0.0/schema.json) | The cybersecurity manager licence (`CybersecurityManagerLicence`) that a certification body accredited under ISO/IEC 17024 grants under NBÚ's certification scheme and Annex 5 of Decree No. 492/2022 Coll. Its 19 attributes, with their labels (`title`), hints (`description`), defaults and which are required, in English, include the role and the ECSF role profile it corresponds to (Chief Information Security Officer). Dates are `format: date`; the holder's `id` is `format: uri`. Extends EBSI's Verifiable Attestation (VCDM 1.1). Described attribute by attribute in its [data model](cybersecurity-manager-licence/1.0.0/data-model.md). | `z3HnfZRoKcq3uWw6rQaJJXu7Qj6amQ7d8FCQbj3vWj4hM` (`0x22044cd7…b990`) |
| [`licence-status-entry/1.0.0`](licence-status-entry/1.0.0/schema.json) | The licence's `credentialStatus`: exactly one `PlrLedgerStatusEntry`, naming the licence registry contract that keeps its record. Other status entries may sit beside it. A type extension; unlike EBSI's own type extensions, it also extends EBSI's Verifiable Attestation, so it validates a complete credential. | `z42xfynkJ57oPfPEtxWjJ1sb67nWFETyHWBHv8MoNMK3A` (`0x2d139716…d8b5`) |

The ids are those EBSI's schema repository computes for these schemas (see below how). They
become final when the Support Office registers the schemas.

[`cybersecurity-manager-licence/1.0.0/example.json`](cybersecurity-manager-licence/1.0.0/example.json)
is a complete licence with sample data. It names schemas and the issuer's accreditation by
EBSI URIs (`ebsi:pilot:schemas-registry:/schemas/<id>`,
`ebsi:pilot:issuers-registry:/issuers/<DID>/attributes/<id>`). It is valid against both
schemas, EBSI's Verifiable Attestation and EBSI's `IssuanceCertificate` type extension. Its
status entry names the pilot ledger (chain 6179) and an illustrative contract address: the
licence registry contracts are still in EBSI's review, so no address exists yet.

## What not to register

The trust chain's credentials use EBSI's own schemas, which the registry already holds. Their
ids differ between the legacy Trusted Schemas Registry v3 and Core API v1:

| Credential | EBSI schema | Core API v1 id | Legacy TSR v3 id |
|---|---|---|---|
| Base of every credential | EBSI Verifiable Attestation (VCDM 1.1) | `zH74MKkYTbQ6ZfTxufi6A3Aw8giS4piGm8dpgxFmkJjmu` | the same (`0xef484394…c5ec`) |
| VerifiableAccreditationToAccredit, VerifiableAccreditationToAttest | EBSI Verifiable Accreditation Record | `z81JSYPHw7LXo67kdSXr4yQak8LQYHfwie7WqSjdSm8Fy` | `zHXHLkJpZg4w9nt2GbEBbyE8uhkfirbmT3nF7mJ9kFnjv` |
| VerifiableAuthorisationToOnboard, VerifiableAuthorisationForTrustChain | EBSI Verifiable Authorisation | `zeZYH8V9SZZdY5Vn78EKraSj9LvjFc2WzPtvmMG3DVdo` | `zBE5cU4EGs5AABdrPRfMfGSZ63oMi6yet5gYTEKYmstAa` |
| `termsOfUse` of type `IssuanceCertificate` | EBSI type extension for use of IssuanceCertificate | `zDidyzBSNZV1jwjauh6CPYJL6cy6XWcHjbeMXQXmTzox8` | `z2yw1Mq2Cq4jN8B2bJ66cGcFEqjrJQUinxHAUjZTkVKjz` |

The copies in [`ebsi/`](ebsi) are the legacy ones, which the back-office and the development
registry use today (see [After registration](#after-registration)).

## How to submit

Following [Publish your schema](https://hub.ebsi.eu/docs/services/trust-chains-and-trusted-issuers/data-models/publish-schema),
the request to the Support Office (support@europeum.eu) includes:

- the data model template, describing each attribute
  ([`data-model.md`](cybersecurity-manager-licence/1.0.0/data-model.md));
- the JSON Schemas in this folder;
- an acknowledgement from the domain's representative that the schema is recognised in the
  domain (for the cybersecurity manager licence, the National Security Authority);
- confirmation that the persons and the certification body named in the examples are fictitious.

The schemas and their examples go into EBSI's schema repository by merge request
(EBSISD-5072).

Both schemas use `$schema` `https://json-schema.org/draft/2020-12/schema`, the only version
the registry accepts.

The registry forms a schema's id from its content: it bundles the schema with the Verifiable
Attestation it extends, removes its annotations (`title`, `description`, `default`, `examples`),
canonicalises it (JCS, RFC 8785), hashes it with SHA-256 and encodes the hash in multibase
base58btc (`z…`); the hexadecimal form (`0x…`) is the same hash. Fixing a label, a hint or a
default therefore keeps the id; any other change is a new schema version, with a new id.

## After registration

On Core API v1, a schema is read from `/v1/schemas-registry/schemas/<id>`, and credentials
name it as `ebsi:pilot:schemas-registry:/schemas/<id>`.

The back-office does not do that yet. Its hosted configuration
([`infra/docker-compose.prod.yml`](../infra/docker-compose.prod.yml)) uses the pilot's legacy
APIs (`PLR_EBSI_API=pilot`, `PLR_TSR_URL=…/trusted-schemas-registry/v3`), names schemas in
credentials by legacy URLs, and expects the legacy ids of EBSI's schemas above. Moving it to
Core API v1 (`PLR_EBSI_API=core-v1`, the Core API v1 ids, and EBSI URIs in credentials) is
open. Until then, the settings are:

```sh
PLR_EBSI_API_ORIGIN=https://api-pilot.ebsi.eu
PLR_TSR_SCHEMAS=z3HnfZRoKcq3uWw6rQaJJXu7Qj6amQ7d8FCQbj3vWj4hM
PLR_LEDGER_STATUS_ENTRY_SCHEMA_URL=https://api-pilot.ebsi.eu/trusted-schemas-registry/v3/schemas/z42xfynkJ57oPfPEtxWjJ1sb67nWFETyHWBHv8MoNMK3A
```

What a licence carries follows EBSI's rules: `issued` is the instant it was signed (the
JWT's `iat`), `issuanceDate` is the same as `validFrom` (the JWT's `nbf`), and it has exactly
three `credentialSchema` entries: its own schema, the status entry's, and EBSI's
`IssuanceCertificate` type extension. The back-office issues exactly one `credentialStatus`
entry, the `PlrLedgerStatusEntry`, and refuses a licence in any other form. The
back-office and the Wallet validate a schema together with the EBSI schema it extends, which
they read by its id from the configured registry, and a presentation may withhold the
attributes the schema requires. The trust chain's credentials name EBSI's schemas above.

The schemas are written in English. The console and the Wallet name a licence's
attributes with its schema's labels and hints, in both of their languages; they keep no names
of their own for attributes, so a schema registered later is shown in its own words.

## In development

The development installation registers the same files in its own registry:
`cybersecurity-manager-licence/1.0.0` as `zPlrCybersecurityManagerV3`, the status entry as
`zPlrLicenceStatusEntryV5`, and copies of EBSI's schemas from [`ebsi/`](ebsi) under their
legacy ids. The back-office reads them from `back-office/shared/schemas.json`, which
`node back-office/scripts/sync-schemas.ts` writes from this folder; CI fails when it is stale.
