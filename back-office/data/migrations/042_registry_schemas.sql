-- Certificate schemas come from EBSI's Trusted Schemas Registry, by the ids the installation
-- names (PLR_TSR_SCHEMAS); nobody drafts one here any more. Drafts never registered go, and a
-- schema left without a version is retired. Registered versions stay: issued certificates name them.
DELETE FROM certificate_schema_versions WHERE registered_at IS NULL;

UPDATE certificate_schemas s SET retired_at = now()
WHERE s.retired_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM certificate_schema_versions v WHERE v.schema_id = s.id);
