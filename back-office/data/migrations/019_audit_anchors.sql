CREATE TABLE audit_anchors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id bigint NOT NULL UNIQUE REFERENCES audit_entries(id) ON DELETE RESTRICT,
    digest bytea NOT NULL CHECK (octet_length(digest) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    chain_id bigint CHECK (chain_id > 0),
    contract text,
    signer_address text,
    raw_transaction text CHECK (raw_transaction ~ '^0x([0-9a-f]{2})+$'),
    transaction_hash text CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    transaction_nonce numeric(78,0) CHECK (transaction_nonce >= 0),
    prepared_at timestamptz,
    attempted_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    delivery_failed boolean NOT NULL DEFAULT false,
    confirmed_at timestamptz,
    block_number bigint CHECK (block_number >= 0),
    block_hash text CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    timestamped_at timestamptz,
    CHECK ((chain_id IS NULL) = (contract IS NULL) AND (chain_id IS NULL) = (signer_address IS NULL)),
    CHECK ((raw_transaction IS NULL) = (transaction_hash IS NULL)
      AND (raw_transaction IS NULL) = (transaction_nonce IS NULL)
      AND (raw_transaction IS NULL) = (prepared_at IS NULL)),
    CHECK (raw_transaction IS NULL OR chain_id IS NOT NULL),
    CHECK ((confirmed_at IS NULL) = (block_number IS NULL) AND (confirmed_at IS NULL) = (block_hash IS NULL)
      AND (confirmed_at IS NULL) = (timestamped_at IS NULL)),
    CHECK (confirmed_at IS NULL OR chain_id IS NOT NULL)
);

CREATE INDEX audit_anchors_pending ON audit_anchors(entry_id) WHERE confirmed_at IS NULL;

CREATE FUNCTION audit_requires_anchor(event_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
    SELECT event_name IN (
      'audit.journal_started', 'audit.preimage_disclosed', 'audit.reason_disclosed',
      'organization.selected', 'organization.invited', 'organization.lifespan',
      'organization.grants_removed', 'organization.accredited', 'organization.revoked', 'organization.registered',
      'schema.proposed', 'schema.registered', 'schema.retired', 'schema.renamed',
      'certificate.registered', 'certificate.issued', 'offer.created', 'offer.token_issued',
      'status.change_proposed', 'status.change_approved', 'status.change_rejected', 'status.change_withdrawn',
      'status.withdrawal_requested', 'status.emergency_suspension', 'status.emergency_confirmed',
      'status.change_applied', 'governance.cancelled', 'governance.expired'
    )
$$;

CREATE FUNCTION enqueue_audit_anchor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF public.audit_requires_anchor(NEW.event) THEN
        INSERT INTO public.audit_anchors (entry_id, digest) VALUES (NEW.id, NEW.entry_hash);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_anchor_enqueue AFTER INSERT ON audit_entries
    FOR EACH ROW EXECUTE FUNCTION enqueue_audit_anchor();

-- Entries from the previous journal migration are covered as well.
INSERT INTO audit_anchors (entry_id, digest)
    SELECT id, entry_hash FROM audit_entries WHERE audit_requires_anchor(event);

CREATE FUNCTION protect_audit_anchor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP IN ('DELETE','TRUNCATE') THEN
        RAISE EXCEPTION 'Audit anchors cannot be removed' USING ERRCODE = '55000';
    END IF;
    IF NEW.id <> OLD.id OR NEW.entry_id <> OLD.entry_id OR NEW.digest <> OLD.digest OR NEW.created_at <> OLD.created_at
      OR (OLD.chain_id IS NOT NULL AND ROW(NEW.chain_id,NEW.contract,NEW.signer_address)
        IS DISTINCT FROM ROW(OLD.chain_id,OLD.contract,OLD.signer_address))
      OR (OLD.raw_transaction IS NOT NULL AND ROW(NEW.raw_transaction,NEW.transaction_hash,NEW.transaction_nonce,NEW.prepared_at)
        IS DISTINCT FROM ROW(OLD.raw_transaction,OLD.transaction_hash,OLD.transaction_nonce,OLD.prepared_at)) THEN
        RAISE EXCEPTION 'Audit anchor identity and signed submission are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_anchor_protect BEFORE UPDATE OR DELETE ON audit_anchors
    FOR EACH ROW EXECUTE FUNCTION protect_audit_anchor();
CREATE TRIGGER audit_anchor_no_truncate BEFORE TRUNCATE ON audit_anchors
    FOR EACH STATEMENT EXECUTE FUNCTION protect_audit_anchor();

REVOKE ALL ON audit_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_requires_anchor(text), enqueue_audit_anchor(), protect_audit_anchor() FROM PUBLIC;
