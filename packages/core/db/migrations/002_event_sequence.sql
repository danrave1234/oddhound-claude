-- Per-run event counter: an atomic row-locked increment replaces MAX(seq)+1, which raced when
-- several writers (agent loop, egress callbacks, stop handler) appended events concurrently.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS event_seq integer NOT NULL DEFAULT 0;
UPDATE runs r SET event_seq = COALESCE((SELECT max(seq) FROM run_events e WHERE e.run_id = r.id), 0);
