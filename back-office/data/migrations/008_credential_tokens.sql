ALTER TABLE credential_offers
    ADD CHECK (failed_attempts BETWEEN 0 AND 5);

CREATE TABLE credential_tokens (
    token_digest bytea PRIMARY KEY CHECK (octet_length(token_digest) = 32),
    certificate_id uuid NOT NULL UNIQUE REFERENCES registered_certificates(id) ON DELETE CASCADE,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL,
    redeemed_at timestamptz
);
