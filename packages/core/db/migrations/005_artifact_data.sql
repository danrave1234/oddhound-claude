-- Deployed artifact storage: with ARTIFACT_STORE=db the bytes live in PostgreSQL, so the web app and
-- the worker (separate machines) read the same private evidence. Per-run size caps and the 7-day
-- retention still apply; purgeExpiredArtifacts deletes the rows.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS data bytea;
