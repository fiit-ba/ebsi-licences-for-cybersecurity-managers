CREATE TABLE organization_key_requests (
    organization_id uuid NOT NULL REFERENCES accredited_organizations(id),
    purpose text NOT NULL,
    request_id uuid NOT NULL UNIQUE REFERENCES signing_key_provisions(request_id),
    PRIMARY KEY (organization_id, purpose)
);

CREATE TABLE issuer_accreditation_checks (
    issuer_did text NOT NULL,
    credential_type text NOT NULL,
    result jsonb NOT NULL,
    PRIMARY KEY (issuer_did, credential_type)
);

ALTER TABLE accreditation_withdrawals ADD COLUMN attempted_at timestamptz;

CREATE TABLE organization_case_cancellations (
    proposal_id uuid PRIMARY KEY REFERENCES certificate_status_proposals(id) ON DELETE CASCADE,
    requested_by integer NOT NULL REFERENCES operator_accounts(id),
    reason_salt bytea NOT NULL CHECK (octet_length(reason_salt)=32),
    reason_hash bytea NOT NULL CHECK (octet_length(reason_hash)=32),
    attempted_at timestamptz,
    completed_at timestamptz
);
