-- Owner sign-in handoff: the latest live frame of a run's browser, and owner inputs waiting to be
-- applied. Both are transient: inputs are deleted as soon as the worker applies them (their payload
-- is encrypted because it can contain what the owner types), and frames are deleted when the
-- handoff ends. Neither is ever sent to the model or kept as evidence.
CREATE TABLE IF NOT EXISTS run_live_frames (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  path text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  frame bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_handoff_inputs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_handoff_inputs_run ON run_handoff_inputs (run_id, id);
