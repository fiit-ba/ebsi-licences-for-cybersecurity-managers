ALTER TABLE registered_certificates
    ADD COLUMN ledger_standing text CHECK (ledger_standing IN ('active', 'suspended', 'revoked', 'unknown')),
    ADD COLUMN ledger_observed_at timestamptz,
    ADD CHECK ((ledger_standing IS NULL) = (ledger_observed_at IS NULL));

CREATE INDEX registered_certificates_issuer_order
    ON registered_certificates(issuer_id, created_at DESC, id DESC);
