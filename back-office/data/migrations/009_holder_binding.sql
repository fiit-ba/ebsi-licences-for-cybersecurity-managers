ALTER TABLE credential_tokens
    ADD COLUMN holder_digest bytea CHECK (octet_length(holder_digest) = 32),
    ADD CHECK (redeemed_at IS NULL OR holder_digest IS NULL);
