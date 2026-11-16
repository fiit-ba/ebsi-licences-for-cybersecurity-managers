CREATE TABLE operator_login_limits (
  bucket bytea PRIMARY KEY CHECK (octet_length(bucket)=32),
  attempts integer NOT NULL CHECK (attempts>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX operator_login_limits_expiry ON operator_login_limits(expires_at);
COMMENT ON TABLE operator_login_limits IS
  'Short-lived HMAC-address login admission windows; no usernames or raw addresses.';
