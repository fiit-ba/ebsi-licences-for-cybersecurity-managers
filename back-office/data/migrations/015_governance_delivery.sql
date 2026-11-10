ALTER TABLE certificate_status_proposals
    ADD COLUMN onchain_proposal_id numeric(78,0) CHECK (onchain_proposal_id > 0),
    ADD COLUMN onchain_contract text,
    ADD COLUMN onchain_chain_id bigint CHECK (onchain_chain_id > 0),
    ADD COLUMN onchain_state text NOT NULL DEFAULT 'none'
        CHECK (onchain_state IN ('none','proposed','quorum_reached','timelocked','executed','cancelled','expired')),
    ADD COLUMN closed_at timestamptz,
    ADD COLUMN delivery_attempted_at timestamptz,
    ADD COLUMN delivery_failed boolean NOT NULL DEFAULT false,
    ADD CHECK ((onchain_contract IS NULL) = (onchain_chain_id IS NULL));

DROP INDEX one_open_certificate_status_proposal;
CREATE UNIQUE INDEX one_open_certificate_status_proposal ON certificate_status_proposals(certificate_id)
    WHERE applied_at IS NULL AND closed_at IS NULL AND decision IS DISTINCT FROM 'rejected';
