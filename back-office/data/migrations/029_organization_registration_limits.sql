CREATE TABLE organization_registration_limits (
  bucket bytea PRIMARY KEY CHECK (octet_length(bucket)=32),
  window_start bigint NOT NULL DEFAULT 0,
  current_count integer NOT NULL DEFAULT 0 CHECK (current_count>=0),
  previous_count integer NOT NULL DEFAULT 0 CHECK (previous_count>=0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX organization_registration_limits_expiry ON organization_registration_limits(expires_at);
COMMENT ON TABLE organization_registration_limits IS
  'Atomic weighted-window registration counters keyed by HMAC address; invitation codes, usernames and raw addresses are never stored.';
