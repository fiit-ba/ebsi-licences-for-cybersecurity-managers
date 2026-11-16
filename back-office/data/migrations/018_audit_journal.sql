CREATE TABLE audit_head (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    entry_hash bytea NOT NULL CHECK (octet_length(entry_hash) = 32)
);

INSERT INTO audit_head (entry_hash) VALUES (decode(repeat('00', 32), 'hex'));

CREATE TABLE audit_entries (
    id bigint PRIMARY KEY CHECK (id > 0),
    occurred_at timestamptz NOT NULL,
    event text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
    -- Historical references deliberately survive deletion of source records.
    actor_id integer,
    actor_username text,
    credential_id text,
    proposal_id uuid,
    organization_id uuid,
    detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
    payload text NOT NULL,
    previous_hash bytea NOT NULL CHECK (octet_length(previous_hash) = 32),
    entry_hash bytea NOT NULL CHECK (octet_length(entry_hash) = 32),
    CHECK (entry_hash = sha256(convert_to('ATEST-AUDIT-V1' || chr(10), 'UTF8') || previous_hash || convert_to(payload, 'UTF8'))),
    CHECK (payload::jsonb = jsonb_build_array(
      'ATEST-AUDIT-V1', id::text, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      event, actor_id::text, actor_username, credential_id, proposal_id::text, organization_id::text, detail
    ))
);

CREATE INDEX audit_entries_certificate ON audit_entries (credential_id, id DESC);
CREATE INDEX audit_entries_proposal ON audit_entries (proposal_id, id DESC);

CREATE FUNCTION append_audit_event(
    event_name text, actor integer, credential text, proposal uuid, organization uuid, details jsonb
) RETURNS TABLE (event_id bigint, event_hash bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    next_id bigint;
    previous bytea;
    occurred timestamptz;
    username text;
    body text;
    checksum bytea;
BEGIN
    -- Call after all domain writes. The row serializes the committed chain;
    -- rollback returns its sequence as well as the event to the prior state.
    SELECT h.sequence + 1, h.entry_hash INTO STRICT next_id, previous
      FROM public.audit_head h WHERE h.singleton FOR UPDATE;
    IF (next_id = 1 AND previous <> decode(repeat('00', 32), 'hex')) OR
       (next_id > 1 AND NOT EXISTS (
         SELECT 1 FROM public.audit_entries e WHERE e.id = next_id - 1 AND e.entry_hash = previous
       )) THEN
        RAISE EXCEPTION 'Audit head does not match the journal' USING ERRCODE = '55000';
    END IF;
    occurred := date_trunc('milliseconds', clock_timestamp());
    SELECT a.username INTO username FROM public.operator_accounts a WHERE a.id = actor;
    body := jsonb_build_array(
      'ATEST-AUDIT-V1', next_id::text, to_char(occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      event_name, actor::text, username, credential, proposal::text, organization::text, details
    )::text;
    checksum := sha256(convert_to('ATEST-AUDIT-V1' || chr(10), 'UTF8') || previous || convert_to(body, 'UTF8'));
    INSERT INTO public.audit_entries
      (id, occurred_at, event, actor_id, actor_username, credential_id, proposal_id, organization_id,
        detail, payload, previous_hash, entry_hash)
    VALUES (next_id, occurred, event_name, actor, username, credential, proposal, organization,
      details, body, previous, checksum);
    UPDATE public.audit_head SET sequence = next_id, entry_hash = checksum WHERE singleton;
    RETURN QUERY SELECT next_id, checksum;
END;
$$;

CREATE FUNCTION refuse_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Audit entries are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_entries_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_entries
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_audit_mutation();

-- Declare the coverage boundary rather than invent historical audit events.
SELECT * FROM append_audit_event('audit.journal_started', NULL, NULL, NULL, NULL, jsonb_build_object(
  'format', 'ATEST-AUDIT-V1',
  'legacy_accreditation_events', (SELECT count(*) FROM accreditation_events),
  'legacy_schema_events', (SELECT count(*) FROM schema_events)
));

REVOKE ALL ON audit_head, audit_entries FROM PUBLIC;
REVOKE ALL ON FUNCTION append_audit_event(text, integer, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refuse_audit_mutation() FROM PUBLIC;
