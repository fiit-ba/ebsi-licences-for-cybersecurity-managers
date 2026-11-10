ALTER TABLE certificate_status_proposals
    ADD COLUMN withdrawal_requested_at timestamptz,
    ADD COLUMN withdrawn_by integer REFERENCES operator_accounts(id),
    ADD COLUMN withdrawal_note text,
    ADD COLUMN withdrawal_salt bytea CHECK (octet_length(withdrawal_salt) = 32),
    ADD COLUMN withdrawal_hash bytea CHECK (octet_length(withdrawal_hash) = 32),
    ADD COLUMN withdrawal_completed_at timestamptz,
    ADD CHECK ((withdrawal_requested_at IS NULL) = (withdrawn_by IS NULL)
      AND (withdrawal_requested_at IS NULL) = (withdrawal_note IS NULL)
      AND (withdrawal_requested_at IS NULL) = (withdrawal_salt IS NULL)
      AND (withdrawal_requested_at IS NULL) = (withdrawal_hash IS NULL)),
    ADD CHECK (withdrawal_requested_at IS NULL OR decision IS NOT DISTINCT FROM 'approved'),
    ADD CHECK (withdrawal_completed_at IS NULL OR (withdrawal_requested_at IS NOT NULL AND closed_at IS NOT NULL));
