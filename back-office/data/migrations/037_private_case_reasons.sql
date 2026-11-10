-- Encrypt reason_note and reason_salt when installation field
-- protection is configured. Retain the existing columns and permit bound envelopes.
ALTER TABLE certificate_status_proposals DROP CONSTRAINT certificate_status_proposals_reason_salt_check;
ALTER TABLE certificate_status_proposals ADD CHECK (octet_length(reason_salt)=32 OR octet_length(reason_salt)>=60);
ALTER TABLE certificate_status_proposals DROP CONSTRAINT certificate_status_proposals_withdrawal_salt_check;
ALTER TABLE certificate_status_proposals ADD CHECK (octet_length(withdrawal_salt)=32 OR octet_length(withdrawal_salt)>=60);
ALTER TABLE certificate_emergency_suspensions DROP CONSTRAINT certificate_emergency_suspensions_reason_salt_check;
ALTER TABLE certificate_emergency_suspensions ADD CHECK (octet_length(reason_salt)=32 OR octet_length(reason_salt)>=60);
COMMENT ON COLUMN certificate_status_proposals.reason_note IS 'private reason note; enc:v1 AES-GCM envelope when installation field encryption is configured.';
COMMENT ON COLUMN certificate_status_proposals.reason_salt IS 'private reason salt; AES-GCM envelope authenticated to the public reason commitment when protected.';
ALTER TABLE organization_case_cancellations DROP CONSTRAINT organization_case_cancellations_reason_salt_check;
ALTER TABLE organization_case_cancellations ADD CHECK (octet_length(reason_salt)=32 OR octet_length(reason_salt)>=60);
