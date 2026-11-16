ALTER TABLE presentation_sessions
    ADD COLUMN outcome text,
    ADD COLUMN failure_code text;

UPDATE presentation_sessions SET outcome = 'VALID' WHERE completed_at IS NOT NULL;

ALTER TABLE presentation_sessions
    ADD CHECK ((completed_at IS NULL) = (outcome IS NULL)),
    ADD CHECK ((failure_code IS NOT NULL) = COALESCE(outcome <> 'VALID', false)),
    ADD CHECK (outcome = 'VALID' OR disclosed_data IS NULL);
