// SELF-04 over real HTTP against the running web app: a visitor without the right session cannot read
// another owner's run, event stream, fix brief, export or artifacts. Demo-target runs stay public.
// Run (web app on :3310): node --env-file=.env tests/e2e/web-access.ts
import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../../packages/core/db/pool.ts';
import { demoTargetContract } from '../../packages/core/contracts/contract.ts';
import { canonicalJson, sha256 } from '../../packages/core/ledger/runs.ts';

const base = process.env.WEB_URL ?? 'http://127.0.0.1:3310';
const db = getPool();
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

const owner = `owner-${randomUUID().slice(0, 8)}`;
await db.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Private Owner', $2)`, [owner, `${owner}@example.test`]);
const contract = demoTargetContract('https://private-tenant.example');
const json = canonicalJson(contract);
const runId = (await db.query(`INSERT INTO runs (owner_id, principal, mode, origin, active_origins, environment, test_mode, contract, contract_hash, status)
  VALUES ($1, $2, 'verified_site', 'https://private-tenant.example', ARRAY['https://private-tenant.example'], 'staging', 'active', $3, $4, 'completed') RETURNING id`,
  [owner, `user:${owner}`, json, sha256(json)])).rows[0].id as string;
await db.query(`INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, 1, 'run.status', '{"status":"completed"}')`, [runId]);
const findingId = (await db.query(`INSERT INTO findings (run_id, title, category, verification, impact, confidence, rule_source, expected, observed, device, actor, fingerprint)
  VALUES ($1, 'PRIVATE-SECRET-TITLE', 'verified_issue', 'verified', 'high', 'x', 'r', 'e', 'o', 'desktop', 'A', 'fp') RETURNING id`, [runId])).rows[0].id as string;
const artifactId = (await db.query(`INSERT INTO artifacts (run_id, kind, storage_key, content_type, bytes, expires_at) VALUES ($1, 'screenshot', 'nope', 'image/jpeg', 1, now() + interval '1 day') RETURNING id`, [runId])).rows[0].id as string;

for (const path of [`/api/runs/${runId}`, `/api/runs/${runId}/events`, `/api/findings/${findingId}/brief`, `/api/findings/${findingId}/export`, `/api/artifacts/${artifactId}`, `/runs/${runId}`]) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  check(res.status === 404 && !body.includes('PRIVATE-SECRET-TITLE'), `anonymous ${path} → ${res.status} without leaking content`);
}
for (const path of [`/api/runs/${runId}/stop`, `/api/runs/${runId}/retest`]) {
  const res = await fetch(`${base}${path}`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
  check(res.status === 404, `anonymous POST ${path} → ${res.status}`);
}
const bad = await fetch(`${base}/api/runs/not-a-uuid`); check(bad.status === 404, 'malformed run id → 404');
const demo = (await db.query(`SELECT id FROM runs WHERE mode = 'demo_target' AND status = 'completed' ORDER BY created_at DESC LIMIT 1`)).rows[0];
if (demo) { const res = await fetch(`${base}/api/runs/${demo.id}`); check(res.status === 200, 'public demo-target run is readable without sign-in'); }
const projects = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', origin: 'https://a.example', environment: 'staging' }) });
check(projects.status === 401, `anonymous project creation → ${projects.status}`);
const kill = await fetch(`${base}/api/admin/kill-switch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"on":true}' });
check(kill.status === 404, `anonymous kill switch → ${kill.status}`);

await db.query('DELETE FROM runs WHERE id = $1', [runId]);
await db.query('DELETE FROM "user" WHERE id = $1', [owner]);
await closePool();
console.log(failures.length ? `${failures.length} FAILURE(S)` : 'ALL ACCESS CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
