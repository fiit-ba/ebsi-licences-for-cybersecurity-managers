ALTER TABLE certificate_schemas
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN retired_by integer REFERENCES operator_accounts(id) ON DELETE SET NULL;

ALTER TABLE certificate_schema_versions
    ADD COLUMN proposed_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN proposed_by integer REFERENCES operator_accounts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX certificate_schema_single_draft
    ON certificate_schema_versions (schema_id) WHERE registered_at IS NULL;

CREATE TABLE schema_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    action text NOT NULL,
    credential_type text NOT NULL,
    version integer,
    actor_id integer NOT NULL
);
