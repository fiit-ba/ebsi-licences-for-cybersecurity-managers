ALTER TABLE operator_accounts
    ADD COLUMN first_name text NOT NULL DEFAULT '',
    ADD COLUMN last_name text NOT NULL DEFAULT '';

CREATE TABLE operator_password_resets (
    account_id integer PRIMARY KEY REFERENCES operator_accounts(id) ON DELETE CASCADE,
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 32),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    auth_version integer NOT NULL,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    delivered_at timestamptz,
    attempted_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    CHECK (expires_at > created_at)
);

CREATE INDEX operator_password_resets_delivery ON operator_password_resets(requested_at)
    WHERE delivered_at IS NULL OR delivered_at < requested_at;
CREATE INDEX operator_password_resets_expiry ON operator_password_resets(expires_at);

CREATE TABLE operator_recovery_limits (
    bucket bytea PRIMARY KEY CHECK (octet_length(bucket) = 32),
    requests timestamptz[] NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL
);

CREATE INDEX operator_recovery_limits_expiry ON operator_recovery_limits(expires_at);

COMMENT ON TABLE operator_password_resets IS
    'One outstanding password recovery per account. HMAC-derived bearer tokens are not stored; nonce and digest require an external recovery key.';
COMMENT ON TABLE operator_recovery_limits IS
    'Shared sliding-window request limits keyed by HMAC; raw client addresses and email addresses are not stored here.';
