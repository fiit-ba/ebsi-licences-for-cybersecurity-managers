CREATE TABLE certificate_schemas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_type text NOT NULL UNIQUE CHECK (btrim(credential_type) <> ''),
    name_sk text NOT NULL CHECK (btrim(name_sk) <> ''),
    name_en text NOT NULL DEFAULT '',
    retired_at timestamptz
);

CREATE TABLE certificate_schema_versions (
    schema_id uuid REFERENCES certificate_schemas(id) ON DELETE RESTRICT,
    version integer CHECK (version > 0),
    fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
    tsr_id text,
    registered_at timestamptz,
    PRIMARY KEY (schema_id, version),
    CHECK ((registered_at IS NULL) = (tsr_id IS NULL))
);

CREATE TABLE organization_certificate_schemas (
    organization_id uuid REFERENCES accredited_organizations(id) ON DELETE CASCADE,
    schema_id uuid REFERENCES certificate_schemas(id) ON DELETE RESTRICT,
    PRIMARY KEY (organization_id, schema_id)
);
