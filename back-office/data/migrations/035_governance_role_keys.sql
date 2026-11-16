-- Governance A/B keys belong to the registry rather than an issuing organization.
-- Store these global roles separately from organization-bound issuer keys.
CREATE TABLE governance_role_keys (
    role text PRIMARY KEY CHECK (role IN ('A','B')),
    request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    phase text NOT NULL DEFAULT 'planned' CHECK (phase IN ('planned','started','active')),
    kms_key_id text UNIQUE,
    public_jwk jsonb,
    address text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((phase='active')=(public_jwk IS NOT NULL) AND (phase='active')=(address IS NOT NULL)),
    CHECK (phase<>'active' OR kms_key_id IS NOT NULL)
);
COMMENT ON TABLE governance_role_keys IS
    'Registry-global body role keys, never supervisory C. KMS creation is idempotent and uncertain responses require tag-verified recovery.';
