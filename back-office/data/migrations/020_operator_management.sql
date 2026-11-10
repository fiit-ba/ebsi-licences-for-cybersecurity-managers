ALTER TABLE operator_accounts
    ADD COLUMN auth_version integer NOT NULL DEFAULT 0 CHECK (auth_version >= 0);

ALTER TABLE operator_roles DROP CONSTRAINT operator_roles_role_check;
ALTER TABLE operator_roles ADD CONSTRAINT operator_roles_role_check CHECK (role IN (
    'plr_admin', 'plr_issuer', 'plr_status_manager', 'plr_verifier',
    'plr_auditor', 'plr_tao', 'plr_rtao'
));

COMMENT ON COLUMN operator_accounts.auth_version IS
    'Session generation; supported administrative changes invalidate previously issued operator JWTs.';
