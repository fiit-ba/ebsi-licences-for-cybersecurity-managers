-- Store encrypted decision snapshots and their digests independently of
-- journal-prefix timestamp evidence.
CREATE TABLE decision_anchors (
    id uuid PRIMARY KEY,
    digest bytea NOT NULL UNIQUE CHECK (octet_length(digest)=32),
    certificate_id uuid REFERENCES registered_certificates(id) ON DELETE SET NULL,
    credential_id text NOT NULL,
    proposal_id uuid,
    kind text NOT NULL,
    decision_encrypted bytea NOT NULL,
    timestamp_id text,
    transaction_hash text,
    anchored_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON COLUMN decision_anchors.proposal_id IS
    'Immutable logical case reference, including a protective case stored in the separate emergency delivery table. No FK erases that audit reference.';
COMMENT ON TABLE decision_anchors IS
    'private decision snapshots and PLR-DECISION-V1 digests. Only digests cross the timestamp boundary; ciphertext is never returned by the audit API.';
ALTER TABLE audit_anchors ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE audit_anchors ADD COLUMN decision_id uuid UNIQUE REFERENCES decision_anchors(id) ON DELETE RESTRICT;
ALTER TABLE audit_anchors ADD CHECK ((entry_id IS NULL)<>(decision_id IS NULL));

CREATE OR REPLACE FUNCTION protect_audit_anchor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP IN ('DELETE','TRUNCATE') THEN
        RAISE EXCEPTION 'Audit anchors cannot be removed' USING ERRCODE = '55000';
    END IF;
    IF ROW(NEW.id,NEW.entry_id,NEW.decision_id,NEW.digest,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.entry_id,OLD.decision_id,OLD.digest,OLD.created_at)
      OR (OLD.chain_id IS NOT NULL AND ROW(NEW.chain_id,NEW.contract,NEW.signer_address)
        IS DISTINCT FROM ROW(OLD.chain_id,OLD.contract,OLD.signer_address))
      OR (OLD.raw_transaction IS NOT NULL AND ROW(NEW.raw_transaction,NEW.transaction_hash,NEW.transaction_nonce,NEW.prepared_at)
        IS DISTINCT FROM ROW(OLD.raw_transaction,OLD.transaction_hash,OLD.transaction_nonce,OLD.prepared_at)) THEN
        RAISE EXCEPTION 'Audit anchor identity and signed submission are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
