CREATE TABLE accreditation_withdrawals (
    revoked_organization_id uuid REFERENCES accredited_organizations(id) ON DELETE RESTRICT,
    affected_organization_id uuid REFERENCES accredited_organizations(id) ON DELETE RESTRICT,
    requested_at timestamptz NOT NULL,
    requested_by integer NOT NULL,
    tir_completed_at timestamptz,
    certificates_completed_at timestamptz,
    PRIMARY KEY (revoked_organization_id, affected_organization_id)
);
