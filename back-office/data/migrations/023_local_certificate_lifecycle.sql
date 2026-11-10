ALTER TABLE registered_certificates
    ADD COLUMN local_standing text NOT NULL DEFAULT 'active'
        CHECK (local_standing IN ('active', 'suspended', 'revoked'));

-- Retain the latest known standing without treating an unknown observation as active.
UPDATE registered_certificates c SET local_standing = COALESCE((
    SELECT evidence.standing FROM (
        SELECT CASE p.action WHEN 'suspend' THEN 'suspended' WHEN 'revoke' THEN 'revoked' ELSE 'active' END AS standing,
            p.applied_at AS occurred_at
        FROM certificate_status_proposals p WHERE p.certificate_id = c.id AND p.applied_at IS NOT NULL
        UNION ALL
        SELECT 'suspended', e.applied_at FROM certificate_emergency_suspensions e
        WHERE e.certificate_id = c.id AND e.applied_at IS NOT NULL
        UNION ALL
        SELECT c.ledger_standing, c.ledger_observed_at
        WHERE c.ledger_standing IN ('active', 'suspended', 'revoked')
    ) evidence ORDER BY evidence.occurred_at DESC, evidence.standing DESC LIMIT 1
), 'active');

ALTER TABLE certificate_status_proposals
    ADD COLUMN requires_governance boolean NOT NULL DEFAULT true,
    ADD COLUMN delivery_uncertain boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN registered_certificates.local_standing IS
    'Committed local lifecycle state; authoritative before collection or in explicit local mode. Collected ledger-mode records still require a fresh chain observation.';
COMMENT ON COLUMN certificate_status_proposals.requires_governance IS
    'Execution policy captured when the request is proposed; a later runtime change cannot bypass its required governance decision.';
COMMENT ON COLUMN certificate_status_proposals.delivery_uncertain IS
    'Durable reconciliation guard set before a delivery attempt; an exactly observed result clears it. Uncertain delivery prevents finalization from using a stale local standing.';
