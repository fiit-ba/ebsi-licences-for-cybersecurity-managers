-- A status proposal keeps rejection separately from its earlier approval.
-- A single decision column cannot retain both controls when an approved case is rejected.
ALTER TABLE certificate_status_proposals
    ADD COLUMN rejected_at timestamptz,
    ADD COLUMN rejected_by integer REFERENCES operator_accounts(id),
    ADD COLUMN rejection_delivered_at timestamptz;
COMMENT ON COLUMN certificate_status_proposals.rejected_at IS
    'Closes the case without erasing a previously recorded independent approval. Its on-chain veto is retried separately.';
