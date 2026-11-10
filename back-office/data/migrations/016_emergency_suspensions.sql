ALTER TABLE registered_certificates ADD COLUMN ledger_observation_invalidated_at timestamptz;

CREATE TABLE certificate_emergency_suspensions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id uuid NOT NULL REFERENCES registered_certificates(id) ON DELETE RESTRICT,
    requested_by integer NOT NULL REFERENCES operator_accounts(id),
    requested_at timestamptz NOT NULL DEFAULT now(),
    reason_code text NOT NULL,
    reason_note text NOT NULL,
    reason_salt bytea NOT NULL CHECK (octet_length(reason_salt) = 32),
    reason_hash bytea NOT NULL CHECK (octet_length(reason_hash) = 32),
    onchain_contract text,
    onchain_chain_id bigint CHECK (onchain_chain_id > 0),
    applied_at timestamptz,
    delivery_attempted_at timestamptz,
    delivery_failed boolean NOT NULL DEFAULT false,
    CHECK ((onchain_contract IS NULL) = (onchain_chain_id IS NULL))
);

-- A pending emergency blocks local verification until chain confirmation.
CREATE UNIQUE INDEX one_pending_emergency_suspension
    ON certificate_emergency_suspensions(certificate_id) WHERE applied_at IS NULL;
