-- The certificate registry and per-TI governance contracts (CertificateRegistry and
-- CertificateGovernance), EBSI Core API v1 publication, OpenID4VCI 1.0 and OpenID4VP 1.0.

-- Each TI has its own A and B governance keys, capabilityInvocation keys of its DID.
-- The registry-global body keys of the single-TI contract have no role on the new contracts.
ALTER TABLE issuer_signing_keys DROP CONSTRAINT issuer_signing_keys_purpose_check;
ALTER TABLE issuer_signing_keys ADD CONSTRAINT issuer_signing_keys_purpose_check
    CHECK (purpose IN ('credential_signing', 'did_authentication', 'ledger_transactions',
                       'timestamp_transactions', 'governance_role_a', 'governance_role_b'));
ALTER TABLE signing_key_provisions DROP CONSTRAINT signing_key_provisions_purpose_check;
ALTER TABLE signing_key_provisions ADD CONSTRAINT signing_key_provisions_purpose_check
    CHECK (purpose IN ('credential_signing', 'did_authentication', 'ledger_transactions',
                       'timestamp_transactions', 'governance_role_a', 'governance_role_b'));
DROP TABLE governance_role_keys;

-- What an organization holds from EBSI for the Trusted Contracts, and when its TI was set
-- up on the governance contract (addTi, confirmed).
ALTER TABLE accredited_organizations
    ADD COLUMN ebsi_invoke_credential text CHECK (length(ebsi_invoke_credential) <= 16384),
    ADD COLUMN governance_configured_at timestamptz;
COMMENT ON COLUMN accredited_organizations.ebsi_invoke_credential IS
    'VerifiableAuthorisationToInvoke the organization presents for ledger:invoke tokens. Public; no private material.';

-- A certificate's record is kept under SHA-256(abi.encode("PLR-CERTIFICATE-V4", TI DID,
-- SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", vc.id)))), known once the holder collected the
-- credential, together with the hash of the signed JWT. Keys of the previous contract
-- (issuer DID and number) and certificates collected before have neither; they are not
-- recorded on the new contract and must be issued again.
ALTER TABLE registered_certificates ALTER COLUMN status_key DROP NOT NULL;
UPDATE registered_certificates SET status_key = NULL;
ALTER TABLE registered_certificates
    ADD COLUMN credential_hash bytea CHECK (octet_length(credential_hash) = 32),
    ADD CONSTRAINT collected_record_key CHECK ((status_key IS NULL) = (credential_hash IS NULL));
COMMENT ON COLUMN registered_certificates.status_key IS
    'V4 record key on the certificate registry, from the TI DID and the collected credential id.';
COMMENT ON COLUMN registered_certificates.credential_hash IS
    'SHA-256 of the collected credential''s signed JWT (before the first ~), as recorded on chain.';

-- APPROVED replaces QUORUM_REACHED and TIMELOCKED; executableAt says when it can run.
ALTER TABLE certificate_status_proposals DROP CONSTRAINT certificate_status_proposals_onchain_state_check;
UPDATE certificate_status_proposals SET onchain_state = 'approved'
    WHERE onchain_state IN ('quorum_reached', 'timelocked');
ALTER TABLE certificate_status_proposals ADD CONSTRAINT certificate_status_proposals_onchain_state_check
    CHECK (onchain_state IN ('none', 'proposed', 'approved', 'executed', 'cancelled', 'expired'));

-- OpenID4VCI 1.0: c_nonce comes from the Nonce Endpoint, not the token response.
CREATE TABLE credential_nonces (
    nonce_digest bytea PRIMARY KEY CHECK (octet_length(nonce_digest) = 32),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
CREATE INDEX credential_nonces_expiry ON credential_nonces(expires_at);
COMMENT ON TABLE credential_nonces IS
    'One-time c_nonce values from the OpenID4VCI 1.0 Nonce Endpoint, stored only as digests.';
ALTER TABLE credential_tokens ALTER COLUMN nonce DROP NOT NULL;
-- The offer's tx_code says how many digits the separately delivered PIN has.
ALTER TABLE credential_offers ADD COLUMN pin_length smallint CHECK (pin_length BETWEEN 1 AND 128);

-- OpenID4VP 1.0: a verify flow asks with a DCQL query; Presentation Exchange is gone. The
-- default flow names the four claims a verifier needs and the eleven the holder may add, and
-- accepts all of them or the four alone (claim_sets in the verifier's order of preference).
ALTER TABLE presentation_definitions ADD COLUMN dcql_query jsonb
    CHECK (dcql_query IS NULL OR jsonb_typeof(dcql_query) = 'object');
UPDATE presentation_definitions SET dcql_query =
    '{"credentials":[{"id":"cybersecurity_manager_certificate","format":"jwt_vc_json","meta":{"type_values":[["CybersecurityManagerCertificate"]]},"require_cryptographic_holder_binding":true,"claims":[{"id":"certificateTitle","path":["credentialSubject","certificateTitle"]},{"id":"holderName","path":["credentialSubject","holderName"]},{"id":"certificateNumber","path":["credentialSubject","certificateNumber"]},{"id":"certificationBody","path":["credentialSubject","certificationBody"]},{"id":"jobPosition","path":["credentialSubject","jobPosition"]},{"id":"trainingName","path":["credentialSubject","trainingName"]},{"id":"trainingStart","path":["credentialSubject","trainingStart"]},{"id":"trainingEnd","path":["credentialSubject","trainingEnd"]},{"id":"trainingDays","path":["credentialSubject","trainingDays"]},{"id":"teachingHours","path":["credentialSubject","teachingHours"]},{"id":"knowledgeStandard","path":["credentialSubject","knowledgeStandard"]},{"id":"placeOfIssue","path":["credentialSubject","placeOfIssue"]},{"id":"issueDate","path":["credentialSubject","issueDate"]},{"id":"signatory","path":["credentialSubject","signatory"]},{"id":"funding","path":["credentialSubject","funding"]}],"claim_sets":[["certificateTitle","holderName","certificateNumber","certificationBody","jobPosition","trainingName","trainingStart","trainingEnd","trainingDays","teachingHours","knowledgeStandard","placeOfIssue","issueDate","signatory","funding"],["certificateTitle","holderName","certificateNumber","certificationBody"]]}]}'
    WHERE definition_id = 'plr-cybersecurity-manager';

-- EBSI's Timestamp contract takes a hash only from a sender that committed to it at least five
-- blocks earlier. An anchor keeps both signed transactions, signed together before either is
-- sent: the commitment (nonce n) and, as before, the timestamp itself (nonce n+1).
ALTER TABLE audit_anchors
    ADD COLUMN commit_transaction text CHECK (commit_transaction ~ '^0x([0-9a-f]{2})+$'),
    ADD COLUMN commit_hash text CHECK (commit_hash ~ '^0x[0-9a-f]{64}$'),
    ADD CHECK ((commit_transaction IS NULL) = (commit_hash IS NULL)),
    ADD CHECK (commit_transaction IS NULL OR raw_transaction IS NOT NULL);

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
      OR (OLD.raw_transaction IS NOT NULL AND ROW(NEW.raw_transaction,NEW.transaction_hash,NEW.transaction_nonce,
          NEW.commit_transaction,NEW.commit_hash,NEW.prepared_at)
        IS DISTINCT FROM ROW(OLD.raw_transaction,OLD.transaction_hash,OLD.transaction_nonce,
          OLD.commit_transaction,OLD.commit_hash,OLD.prepared_at)) THEN
        RAISE EXCEPTION 'Audit anchor identity and signed submission are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_audit_anchor() FROM PUBLIC;
