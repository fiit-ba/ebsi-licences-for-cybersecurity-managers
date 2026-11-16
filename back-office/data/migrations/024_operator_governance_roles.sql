CREATE TABLE operator_governance_roles (
    account_id integer NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('A', 'B', 'C')),
    PRIMARY KEY (account_id, role)
);

COMMENT ON TABLE operator_governance_roles IS
    'Explicit operator signer-role memberships. Account administration alone grants no ledger signing authority.';
