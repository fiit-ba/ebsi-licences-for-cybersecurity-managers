-- D31: retain one opaque encrypted backup per public backup key.
CREATE TABLE plr_walletbackup (
  backup_id varchar(43) PRIMARY KEY,
  public_key jsonb NOT NULL,
  ciphertext text NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Shared storage for the two weighted-window admission counters.
-- Address digests are independent of backup IDs; expired buckets are disposable.
CREATE TABLE wallet_backup_limits (
  bucket bytea PRIMARY KEY,
  window_start bigint NOT NULL DEFAULT -1,
  current_count integer NOT NULL DEFAULT 0,
  previous_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX wallet_backup_limits_expiry ON wallet_backup_limits(expires_at);
