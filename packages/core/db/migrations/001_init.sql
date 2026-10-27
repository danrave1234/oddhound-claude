-- Oddhound application schema (one PostgreSQL for data, auth, queue and ledgers).
-- Auth tables follow better-auth's default model names.

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  is_admin boolean NOT NULL DEFAULT false,
  allowlisted boolean NOT NULL DEFAULT false,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  origin text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('staging','production')),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS site_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  origin text NOT NULL,
  revision integer NOT NULL,
  token text NOT NULL UNIQUE,
  method text,
  verified boolean NOT NULL DEFAULT false,
  last_reason text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, origin, revision)
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  owner_id text REFERENCES "user"(id) ON DELETE SET NULL,
  principal text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('verified_site','demo_target','retest')),
  origin text NOT NULL,
  active_origins text[] NOT NULL,
  environment text NOT NULL,
  test_mode text NOT NULL CHECK (test_mode IN ('active','observation_only')),
  contract jsonb NOT NULL,
  contract_hash text NOT NULL,
  status text NOT NULL,
  stop_reason text,
  browser_state text,
  browser_ref text,
  sandbox_verdict text,
  lease_owner text,
  lease_generation integer NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  stop_requested_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  expires_at timestamptz,
  finished_at timestamptz,
  provider text,
  model text,
  spend_account text NOT NULL DEFAULT 'public',
  day_bucket date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  counted_against_quota boolean NOT NULL DEFAULT true,
  parent_run_id uuid REFERENCES runs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS runs_owner_day ON runs(owner_id, day_bucket);
CREATE INDEX IF NOT EXISTS runs_origin ON runs(origin);

CREATE TABLE IF NOT EXISTS run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  generation integer NOT NULL,
  actor text NOT NULL,
  device text NOT NULL,
  tool text NOT NULL,
  args jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('intended','dispatched','succeeded','failed','rejected','outcome_unknown')),
  result jsonb,
  url_before text,
  url_after text,
  intended_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS graph_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  route text NOT NULL,
  title text NOT NULL,
  actor text NOT NULL,
  device text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS graph_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_state uuid REFERENCES graph_states(id) ON DELETE CASCADE,
  to_state uuid NOT NULL REFERENCES graph_states(id) ON DELETE CASCADE,
  action_id uuid REFERENCES actions(id) ON DELETE SET NULL,
  label text NOT NULL,
  observed boolean NOT NULL DEFAULT true,
  UNIQUE (run_id, from_state, to_state, label)
);

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL,
  summary text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, name)
);

-- A scenario's assertion is immutable once saved: retests replay the stored version and hash.
CREATE TABLE IF NOT EXISTS scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  title text NOT NULL,
  rule_id text NOT NULL,
  rule_text text NOT NULL,
  rule_source text NOT NULL,
  device text NOT NULL,
  is_control boolean NOT NULL DEFAULT false,
  control_for uuid REFERENCES scenarios(id) ON DELETE CASCADE,
  steps jsonb NOT NULL,
  assertion jsonb NOT NULL,
  assertion_version integer NOT NULL DEFAULT 1,
  assertion_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scenario_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify','retest')),
  assertion_hash text NOT NULL,
  outcome text NOT NULL,
  observed jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_id uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  control_scenario_id uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  title text NOT NULL,
  category text NOT NULL,
  verification text NOT NULL,
  lifecycle text,
  impact text NOT NULL,
  confidence text NOT NULL,
  rule_id text,
  rule_source text NOT NULL,
  expected text NOT NULL,
  observed text NOT NULL,
  device text NOT NULL,
  actor text NOT NULL,
  limitations text NOT NULL DEFAULT '',
  fingerprint text NOT NULL,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS findings_run ON findings(run_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Spend ledger (integer microdollars). Accounts are separate funding pools.
CREATE TABLE IF NOT EXISTS spend_accounts (
  id text PRIMARY KEY CHECK (id IN ('public','judging','development')),
  lifetime_limit_micros bigint NOT NULL,
  daily_limit_micros bigint
);
CREATE TABLE IF NOT EXISTS spend_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  account text NOT NULL REFERENCES spend_accounts(id),
  day_bucket date NOT NULL,
  reserved_micros bigint NOT NULL CHECK (reserved_micros >= 0),
  actual_micros bigint,
  state text NOT NULL CHECK (state IN ('reserved','settled','released','unknown')),
  provider text NOT NULL,
  model text NOT NULL,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS spend_account_day ON spend_reservations(account, day_bucket);
CREATE INDEX IF NOT EXISTS spend_run ON spend_reservations(run_id);

-- Target test credentials (owner-supplied or generated during a run). Encrypted at rest with
-- AES-256-GCM; only the trusted worker decrypts them, and never into model prompts.
CREATE TABLE IF NOT EXISTS credentials (
  ref text PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
  label text NOT NULL,
  username_enc text NOT NULL,
  secret_enc text NOT NULL,
  generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  origin text,
  run_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO spend_accounts (id, lifetime_limit_micros, daily_limit_micros) VALUES
  ('public', 50000000, 7000000),
  ('judging', 15000000, NULL),
  ('development', 45000000, NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('kill_switch', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
