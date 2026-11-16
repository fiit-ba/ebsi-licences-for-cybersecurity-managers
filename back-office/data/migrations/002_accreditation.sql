CREATE TABLE accredited_organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    kind text NOT NULL CHECK (kind IN ('rtao', 'tao', 'ti')),
    parent_id uuid,
    parent_kind text GENERATED ALWAYS AS (
        CASE kind WHEN 'tao' THEN 'rtao' WHEN 'ti' THEN 'tao' END
    ) STORED,
    account_id integer UNIQUE REFERENCES operator_accounts(id) ON DELETE SET NULL,
    did text NOT NULL DEFAULT '',
    tir_attribute_id text,
    accredited_until timestamptz,
    revoked_at timestamptz,
    revocation_reason text,
    revocation_note text NOT NULL DEFAULT '',
    UNIQUE (id, kind),
    FOREIGN KEY (parent_id, parent_kind) REFERENCES accredited_organizations(id, kind),
    CHECK ((kind = 'rtao') = (parent_id IS NULL)),
    CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE INDEX accredited_organizations_parent ON accredited_organizations(parent_id);
