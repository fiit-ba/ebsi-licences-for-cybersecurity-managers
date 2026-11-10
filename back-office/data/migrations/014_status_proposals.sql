CREATE TABLE ti_status_managers (
    issuer_id uuid REFERENCES accredited_organizations(id) ON DELETE CASCADE,
    account_id integer REFERENCES operator_accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (issuer_id, account_id)
);

CREATE TABLE certificate_status_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id uuid NOT NULL REFERENCES registered_certificates(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('suspend', 'revoke', 'reinstate')),
    initial_standing text NOT NULL CHECK (initial_standing IN ('active', 'suspended')),
    reason_code text NOT NULL,
    reason_note text NOT NULL,
    reason_salt bytea NOT NULL CHECK (octet_length(reason_salt) = 32),
    reason_hash bytea NOT NULL CHECK (octet_length(reason_hash) = 32),
    proposed_by integer NOT NULL REFERENCES operator_accounts(id),
    proposed_at timestamptz NOT NULL DEFAULT now(),
    decided_by integer REFERENCES operator_accounts(id),
    decided_at timestamptz,
    decision text CHECK (decision IN ('approved', 'rejected')),
    applied_at timestamptz,
    CHECK ((decided_at IS NULL) = (decision IS NULL) AND (decided_by IS NULL) = (decision IS NULL)),
    CHECK (decision <> 'approved' OR decided_by <> proposed_by),
    CHECK (applied_at IS NULL OR decision IS NOT DISTINCT FROM 'approved')
);

CREATE UNIQUE INDEX one_open_certificate_status_proposal ON certificate_status_proposals(certificate_id)
    WHERE applied_at IS NULL AND decision IS DISTINCT FROM 'rejected';
