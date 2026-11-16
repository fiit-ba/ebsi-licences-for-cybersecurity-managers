CREATE UNIQUE INDEX operator_username_casefold ON operator_accounts (lower(username));

ALTER TABLE accredited_organizations
    ADD COLUMN contact_email text NOT NULL DEFAULT '',
    ADD COLUMN selected_by integer REFERENCES operator_accounts(id) ON DELETE SET NULL,
    ADD COLUMN selected_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN registered_at timestamptz,
    ADD COLUMN invitation_digest bytea UNIQUE,
    ADD COLUMN invitation_expires_at timestamptz,
    ADD CHECK ((invitation_digest IS NULL) = (invitation_expires_at IS NULL)),
    ADD CHECK (account_id IS NULL OR invitation_digest IS NULL);

CREATE TABLE accreditation_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    action text NOT NULL,
    organization_id uuid NOT NULL,
    actor_id integer NOT NULL,
    details jsonb NOT NULL
);
