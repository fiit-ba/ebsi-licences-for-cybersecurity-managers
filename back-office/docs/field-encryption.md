# Field encryption and key operations

`field_keys` stores only a symmetric KMS key ARN, an installation UUID and two
KMS ciphertexts. KMS generates independent 256-bit secrets: one for AES-GCM data
encryption, one for stable, domain-separated offer PIN HMACs. Session authentication, recovery encryption and purpose-bound
asymmetric signing retain their independent keys. Plaintext data keys are not runtime environment settings.

The runtime unwraps the exact saved pair with KMS `Decrypt`, using authenticated
installation/purpose context, and caches plaintext only in process memory. It
never provisions keys. New envelopes carry an authenticated version marker and
remain bound to the original certificate, presentation or reason owner through
AES-256-GCM AAD. Wrong owners, tampering and unknown formats fail authentication.
Shutdown clears owned key buffers; it does not claim to erase every copy made by
the JavaScript runtime or cryptographic library.

Cold processes refuse dependent operations with `FieldEncryptionUnavailable`
(HTTP 503) if the key record or KMS is unavailable. Failed loads can retry when
KMS returns. A process that already unwrapped keys can continue using its memory
cache during an outage. This is not immediate KMS
revocation: restart/drain warm processes when revoking their access.

## Initial installation

Ordinary local startup remains `docker compose up --build -d` followed by
`./bootstrap.sh` in `infra/`, after configuring the public host and contract.
Bootstrap creates the local symmetric wrapping key and data secrets automatically.
The existing `product-kms:/persisted-data` volume preserves KMS state. Preserve
both PostgreSQL and KMS volumes; a database backup alone cannot recover the keys.
The local emulator and its volume are development facilities, not hosted KMS.

For hosted installation, configure `PLR_FIELD_KMS_KEY_ID` with an enabled
`SYMMETRIC_DEFAULT`, `ENCRYPT_DECRYPT` KMS key. Run the explicit one-time ceremony
with a provisioning identity:

```sh
npm run keys:fields -- bootstrap
```

The provisioning identity needs `kms:DescribeKey`, `kms:GenerateDataKey` and
`kms:Decrypt` for that wrapping key; key import also needs `kms:Encrypt`.
Only local development may call `kms:CreateKey`. Ordinary runtime needs
`kms:Decrypt`, restricted to the wrapping key and expected encryption contexts.
If configuration uses an alias or short ID instead of the stored ARN, runtime
also resolves it with `kms:DescribeKey` and rejects a different key. Prefer the
canonical ARN and workload identity; do not distribute runtime data keys.

Concurrent bootstrap uses a PostgreSQL advisory lock. Repeated bootstrap unwraps
and validates existing material without changing it. KMS errors never deactivate
or replace a stored key. The key pair is published in one insert and cannot be
updated, deleted or truncated. No automatic data-key rotation is implemented:
the derivation secret must remain stable for existing offer PIN digests.

Local wrapping-key creation records intent before `CreateKey`. If its response
is lost, bootstrap refuses another creation. Recover the original KMS ARN by its
`atest-installation` tag matching `field_key_setup.installation_id`, set
`PLR_FIELD_KMS_KEY_ID` to that ARN and retry. Never delete the setup/key records
or KMS state to resolve an outage.

## Importing an unversioned encryption key

An installation with protected data and no `field_keys` row is deliberately
blocked from fresh provisioning. Preserve the exact raw key that protected that data; replacing it would lose both ciphertext and stable
PIN derivation. No import is run automatically against a working DB.

1. Back up PostgreSQL and preserve the original secret privately. Stop all API
   and worker writers, apply current SQL migrations, and prepare a private regular
   file containing the exact 64 hexadecimal characters, permissions `0600`.
   This is the existing secret, not a newly generated key.
2. Remove `BACK_OFFICE_ISSUANCE_KEY` from the command/runtime environment. With the
   migrated database and authorized KMS configuration, run:

   ```sh
   npm run keys:fields -- import-legacy /private/unversioned-field-key
   ```

   In local Compose, after stopping both backend and worker, the equivalent one-off command is:

   ```sh
   docker compose run --rm --no-deps --user "$(id -u):$(id -g)" \
     -v /private/unversioned-field-key:/run/field-key:ro backend \
     node scripts/field-keys.ts import-legacy /run/field-key
   ```

3. The command authenticates **every** existing encrypted certificate payload,
   presentation result/session, decision snapshot, case reason and withdrawal
   field with its exact owner. A wrong key, corruption or KMS failure aborts.
   It wraps the old secret under the derivation context and generates an
   independent AES data key for future writes. No existing ciphertext, audit
   snapshot, offer digest or ledger record is rewritten.
4. Restart backend and worker without the raw key. Check existing offers, private
   disclosures and certificate verification, then remove the temporary secret
   file and old configuration copies according to the deployment's secret policy.

The imported secret remains KMS-wrapped to read unversioned AES-GCM envelopes
and to reproduce the same PIN HMACs. Newly written
data uses the separate AES key and versioned envelope. Previously issued signed
credentials and on-chain records retain their values. Repeating import with
the same secret validates the stored pair; a conflicting import is refused.
Wrapping cannot revoke a raw secret that was already disclosed, or change the
protection of historical backups made before this import.

See [validation](validation.md) for the isolated ordinary-installation runner,
which also executes the private-file import, KMS restart and outage scenarios.
