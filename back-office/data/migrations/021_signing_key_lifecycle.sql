ALTER TABLE issuer_signing_keys
    ADD COLUMN purpose text NOT NULL DEFAULT 'credential_signing'
        CHECK (purpose IN ('credential_signing', 'did_authentication', 'ledger_transactions', 'timestamp_transactions')),
    ADD COLUMN created_at timestamptz,
    ADD COLUMN activated_at timestamptz,
    ADD COLUMN retired_at timestamptz,
    ADD CONSTRAINT active_keys_not_retired CHECK (NOT active OR retired_at IS NULL),
    ADD CONSTRAINT signing_key_window CHECK (activated_at IS NULL OR retired_at IS NULL OR retired_at >= activated_at);

-- Existing rows have unknown lifecycle dates. Do not fabricate historical windows.
ALTER TABLE issuer_signing_keys ALTER COLUMN created_at SET DEFAULT clock_timestamp();
DROP INDEX one_active_issuer_signing_key;
CREATE UNIQUE INDEX one_active_issuer_signing_key
    ON issuer_signing_keys (organization_id, purpose) WHERE active;
CREATE UNIQUE INDEX signing_key_material_not_shared
    ON issuer_signing_keys ((public_jwk->>'kty'), (public_jwk->>'crv'), (public_jwk->>'x'), (public_jwk->>'y'));

CREATE TABLE signing_key_provisions (
    request_id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES accredited_organizations(id),
    purpose text NOT NULL CHECK (purpose IN ('credential_signing', 'did_authentication', 'ledger_transactions', 'timestamp_transactions')),
    phase text NOT NULL DEFAULT 'planned' CHECK (phase IN ('planned', 'started', 'prepared')),
    kms_key_id text,
    kid text,
    requested_by integer REFERENCES operator_accounts(id),
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    started_at timestamptz,
    prepared_at timestamptz,
    FOREIGN KEY (organization_id, kid) REFERENCES issuer_signing_keys(organization_id, kid),
    CHECK ((phase = 'prepared') = (kid IS NOT NULL)),
    CHECK (phase <> 'prepared' OR (kms_key_id IS NOT NULL AND prepared_at IS NOT NULL)),
    CHECK ((phase = 'planned') = (started_at IS NULL))
);

COMMENT ON TABLE signing_key_provisions IS
    'Durable ceremony requests. Started requests without a KMS locator require tag-verified recovery; never blindly repeat CreateKey.';
COMMENT ON INDEX signing_key_material_not_shared IS
    'One EC public key belongs to one organization and purpose, including retired material.';
