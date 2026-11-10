CREATE TABLE issuer_signing_keys (
    organization_id uuid NOT NULL REFERENCES accredited_organizations(id) ON DELETE RESTRICT,
    kid text NOT NULL CHECK (kid <> ''),
    kms_key_id text NOT NULL CHECK (kms_key_id <> ''),
    public_jwk jsonb NOT NULL CHECK (jsonb_typeof(public_jwk) = 'object' AND NOT (public_jwk ? 'd')),
    active boolean NOT NULL DEFAULT false,
    PRIMARY KEY (organization_id, kid)
);

CREATE UNIQUE INDEX one_active_issuer_signing_key
    ON issuer_signing_keys (organization_id) WHERE active;
