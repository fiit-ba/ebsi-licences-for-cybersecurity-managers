-- One-time ledger signing authorizations bind contract calls to their approved
-- parameters and retain signed transaction bytes for recovery.
CREATE TABLE ledger_signing_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key text NOT NULL UNIQUE,
    actor_id integer,
    admin_proposal_id numeric(78,0),
    key_purpose text NOT NULL,
    key_id text NOT NULL,
    signer_address text NOT NULL,
    chain_id bigint NOT NULL CHECK (chain_id > 0),
    contract text NOT NULL,
    contract_function text NOT NULL,
    calldata text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
    consumed_at timestamptz,
    reconciled_at timestamptz,
    reconciliation_attempted_at timestamptz,
    payload_digest text,
    raw_transaction text,
    transaction_hash text,
    CHECK ((consumed_at IS NULL) = (payload_digest IS NULL)
      AND (consumed_at IS NULL) = (raw_transaction IS NULL)
      AND (consumed_at IS NULL) = (transaction_hash IS NULL))
);
COMMENT ON TABLE ledger_signing_intents IS
    'Exact one-time governance signing authorization; signed bytes survive lost RPC responses and worker restarts. Contains public calldata, never holder claims or preimages.';
CREATE INDEX ledger_signing_intents_expiry ON ledger_signing_intents(expires_at);
