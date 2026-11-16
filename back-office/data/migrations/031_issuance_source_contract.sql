-- A certificate keeps its provisional registration identifier after
-- collection binds it to the UUID minted for the signed credential.
ALTER TABLE registered_certificates ADD COLUMN registered_id text;
ALTER TABLE registered_certificates ADD COLUMN ledger_registered_at timestamptz;
-- Ledger registration runs after collection commits. A failed signing attempt
-- does not retain a holder lock.
ALTER TABLE credential_tokens DROP COLUMN holder_digest;
CREATE UNIQUE INDEX registered_certificates_registration_id
    ON registered_certificates(registered_id) WHERE registered_id IS NOT NULL;

COMMENT ON COLUMN registered_certificates.registered_id IS
    'Provisional identifier returned by issue before collection; both identifiers find the same certificate.';

COMMENT ON COLUMN registered_certificates.ledger_registered_at IS
    'Confirmation of initial background registration, independent of subsequent lifecycle standing observations.';

COMMENT ON COLUMN registered_certificates.schema_version IS
    'Version used to normalize the registration request. Collection resolves the current published flow version.';
