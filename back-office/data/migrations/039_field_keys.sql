-- Only KMS ciphertext belongs in PostgreSQL. Runtime cannot provision a missing key.
CREATE TABLE field_key_setup (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    installation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    creation_started boolean NOT NULL DEFAULT false,
    kms_key_id text
);

CREATE TABLE field_keys (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    installation_id uuid NOT NULL,
    kms_key_id text NOT NULL,
    encryption_wrapped bytea NOT NULL CHECK (octet_length(encryption_wrapped)>32),
    derivation_wrapped bytea NOT NULL CHECK (octet_length(derivation_wrapped)>32),
    legacy_readable boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE field_keys IS
    'KMS envelope encryption: independent AES data key and stable PIN/commitment secret, encrypted with installation/purpose context. No plaintext keys.';

CREATE FUNCTION protect_field_keys() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Field key identity and material cannot be replaced or removed' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER field_keys_immutable BEFORE UPDATE OR DELETE ON field_keys
    FOR EACH ROW EXECUTE FUNCTION protect_field_keys();
CREATE TRIGGER field_keys_no_truncate BEFORE TRUNCATE ON field_keys
    FOR EACH STATEMENT EXECUTE FUNCTION protect_field_keys();
