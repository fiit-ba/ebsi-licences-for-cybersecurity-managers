CREATE TABLE presentation_sessions (
    state text PRIMARY KEY CHECK (length(state) = 43),
    owner_id integer NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
    audience text NOT NULL,
    nonce text NOT NULL UNIQUE,
    credential_types text[] NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    evidence jsonb,
    disclosed_data bytea,
    attributes_until timestamptz,
    CHECK ((completed_at IS NULL) = (evidence IS NULL)),
    CHECK ((disclosed_data IS NULL) = (attributes_until IS NULL))
);

CREATE INDEX presentation_attributes_expiry
    ON presentation_sessions(attributes_until) WHERE disclosed_data IS NOT NULL;
