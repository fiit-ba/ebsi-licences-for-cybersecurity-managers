-- A TAO or TI is appointed by its own DID, which it registered in the DID Registry itself. Its
-- accreditor reserves its attribute in the Trusted Issuers Registry and signs the accreditation
-- (VerifiableAccreditationToAccredit or ToAttest); the organization downloads it and stores it in
-- the registry with its own wallet. The back-office keeps the credential it issued, to hand over
-- and to recognise in the registry; tir_attribute_id is set once the registry holds it.
ALTER TABLE accredited_organizations
    ADD COLUMN accreditation_credential text,
    ADD COLUMN accreditation_issued_at timestamptz;

-- One live organization per DID.
CREATE UNIQUE INDEX accredited_organizations_live_did
    ON accredited_organizations (did)
    WHERE did <> '' AND revoked_at IS NULL;
