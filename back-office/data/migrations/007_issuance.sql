CREATE TABLE registered_certificates (
    id uuid PRIMARY KEY,
    credential_id text NOT NULL UNIQUE,
    issuer_id uuid NOT NULL REFERENCES accredited_organizations(id),
    issuer_did text NOT NULL CHECK (issuer_did <> ''),
    issuer_accredited_until timestamptz,
    schema_id uuid NOT NULL,
    schema_version integer NOT NULL,
    certificate_number text NOT NULL CHECK (certificate_number <> ''),
    status_key bytea NOT NULL UNIQUE CHECK (octet_length(status_key) = 32),
    private_data bytea NOT NULL,
    valid_from timestamptz,
    valid_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by integer NOT NULL,
    UNIQUE (issuer_did, certificate_number),
    FOREIGN KEY (schema_id, schema_version) REFERENCES certificate_schema_versions(schema_id, version),
    CHECK (valid_until > valid_from)
);

CREATE TABLE credential_offers (
    certificate_id uuid PRIMARY KEY REFERENCES registered_certificates(id) ON DELETE CASCADE,
    code_digest bytea UNIQUE NOT NULL,
    pin_digest bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    failed_attempts integer NOT NULL DEFAULT 0,
    consumed_at timestamptz
);
