# Oddhound (Claude build) — status report

**Date:** October 27, 2026 · **Repository:** https://github.com/danrave1234/oddhound-claude · **Spec followed:** `docs/spec/` (copy of the shared planning documents)

This is an honest record of what was built, what was actually tested, and what is still open. Nothing here is a security certification.

## 1. What works today (tested)

| Capability | Evidence |
|---|---|
| **Real Meta inference** (Direct Meta `muse-spark-1.3`) | Provider smoke suite passes 9/9 against the live API (`docs/PROVIDER_SMOKE_TESTS.json`): text, tool call, tool-result round-trip, two-turn continuation, screenshot in a user message, structured output via tool arguments, `tool_choice:"required"` rejected (HTTP 400, as documented), timeout handling. |
| **Autonomous exploration with no click script** | Real Muse Spark runs against the demo target registered synthetic accounts, created/edited/cancelled bookings, tried boundary values, blank input, past dates, a second account and a 390×844 phone screen — see §3. |
| **Independent verification** | Every candidate is replayed twice in fresh browser contexts with fresh synthetic accounts, plus a valid neighbouring case for rejected-input rules. Assertions are typed and evaluated by trusted code; the model never runs code. |
| **Unchanged-assertion retest** | Saved scenarios carry an assertion hash; retest refuses a changed assertion. On the corrected build all verified findings flip to *fixed*; on the unfixed build nothing is falsely marked fixed (tested in every e2e run). |
| **Secret-free per-run browser** | `apps/browser` image: Playwright 1.64.1, Chromium as non-root `pwuser` with its own sandbox ON (`chrome://sandbox` → "adequately sandboxed"), SSRF egress proxy as a separate user, nftables so the browser user can only reach the proxy. One fresh container per run, destroyed and confirmed absent afterwards. In-container network self-test: 10/10 (direct TCP, metadata, UDP, private, ULA/6PN, non-web ports, the control port all blocked; the approved target allowed). |
| **Ownership verification** | DNS TXT, `/.well-known` file, `<meta>` in `<head>`; 256-bit tokens; exact-origin; no redirects; 256 KiB / 10 s caps; re-checked before every run. Private/metadata origins refused in the UI and API. |
| **Ledgers under concurrency** | Spend reservations (integer microdollars, $2/run, $7/day public, $50 lifetime, unknown usage stays reserved, kill switch), admission (3 runs/user/day, 1 pending per principal, 1 active run per origin across all projects, 1 live demo globally, demo 1/hour/session), lease fencing, stop-before-ack, stale-run reaper — all tested with racing requests against real PostgreSQL. |
| **Web app** | Next.js 16.4.3 / React 19.3.1, macOS-inspired three-pane workspace, no Lucide (lint enforced), live SSE with `Last-Event-ID` resume, findings grouped into the four canonical categories, evidence-first inspector, fix brief (Markdown/JSON) with clipboard fallback, Playwright export from a trusted template, retest results, mobile layout without horizontal overflow, public demo target + replay, `/status`. Walked through end to end in a browser. |
| **Context7 (MCP v2)** | `@modelcontextprotocol/client` 2.4 over Streamable HTTP; real Next.js docs retrieved; failures degrade to a stack-neutral brief. Only an owner-declared library name and a generic topic are sent. |
| **Queue** | BullMQ 6.4.2 with its PostgreSQL backend (no Redis); stalled jobs are not blindly re-run — the reaper fences them. |

## 2. Test suites

| Suite | Command | Result |
|---|---|---|
| Unit + integration (SSRF policy, egress proxy incl. rebinding and byte/request caps, scope decisions, ownership verification against a live server, ledgers under races, fencing, durable events, report fencing, export template, scenario soundness, credential vault) | `npx vitest run` | **70/70 pass** |
| End-to-end lab, offline test double (deterministic, no paid calls) | `node --env-file=.env tests/e2e/run-e2e.ts` | **15/15 pass** |
| End-to-end lab, real Meta model | `E2E_PROVIDER=meta node --env-file=.env tests/e2e/run-e2e.ts` | see §3 |
| HTTP tenant isolation (SELF-04) against the running web app | `node --env-file=.env tests/e2e/web-access.ts` | **13/13 pass** |
| In-container network self-test (SELF-01/02/08) | `docker exec -u pwuser <run container> node26 /opt/oddhound/netcheck.ts 172.30.77.10 4310` | **10/10 pass** |
| Provider smoke (real API) | `node --env-file=.env tests/smoke/meta-smoke.ts` | **9/9 pass** |
| Context7 smoke | `node tests/smoke/context7-smoke.ts` | pass |
| No-Lucide lint | `node tests/lint/no-lucide.ts` | pass |

Bugs the tests found and that were fixed: an event-sequence race under concurrent writers; an artifact-route status difference that revealed private artifact existence; a verifier false positive when the persistence marker was placed in the field under test; Chromium's output budget being consumed by hidden reasoning (`finish_reason: "length"`); Windows CRLF breaking the in-container firewall rules.

## 3. Real Muse Spark runs on the demo target (chronological)

Each run explores the demo target with only its description, goals and five rules; no defect list, selectors or click scripts. Four rules (R1, R2, R4, R5) have seeded defects; R3 is a control that must *not* be reported.

| # | Turns | Actions | Cost | R1 | R2 | R4 | R5 | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 59 | 49 | $0.23 | ✅ | ✅ | ✅ | ✅ | All verified; all fixed on retest. |
| 2 (UI) | 54 | 44 | $0.19 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Inconclusive: model wrote the sign-up recipe from memory ("Your name" vs "Full name"). → Oddhound now records the real recipe. |
| 3 | 60 | 51 | $0.20 | ✅ | ✅* | ✅ | — | Hit the 60-turn cap (status *stopped*). *R2 was a false positive (marker inside the tested field) — retest refused to mark it fixed. → `testedField` soundness check; `fill_form` batching. |
| 4 | 40 | 32 | $0.16 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Model reported labels it never saw ("Special requests"). → report-time validation returns the real labels so the model corrects itself. |
| 5 | 45 | 35 | $0.16 | ✅ | ✅ | ✅ | ✅ | All verified; all fixed on retest; R3 control not flagged. |
| 6 (UI) | 44 | 35 | $0.14 | ✅ | ✅ | ✅ | ✅ | Through the web UI; retest from the UI marked all four fixed. |
| 7 | 43 | 35 | $0.16 | ⚠️ | ⚠️ | ✅ | ✅ | R1/R2 inconclusive: the model omitted the sign-in step, so the replay hit the login page. → replays now sign in with the recorded recipe when the form was observed signed in. Report-time validation also forced the model to add a valid control value. |
| 8 | 45 | — | $0.17 | ✅ | ✅ | ⚠️ | ✅ | R4 inconclusive: the marker was only in Notes, which the list does not show. → the replay now finds the new record by comparing list links before/after. |
| 9 | 42 | 33 | $0.15 | ✅ | ✅ | ✅ | ✅ | **All 15/15 e2e checks pass** with the real model: all four verified (2/2 replays + controls), R3 control not flagged, all fixed on retest, none falsely fixed on the unfixed build. |

Each failure mode was caught by the verifier and reported truthfully (inconclusive / not fixed), never as a false success; each one led to a fix in Oddhound itself, not in the demo target. Total Meta spend for all development runs and smoke tests: **about $1.56** of the $150 credit.

## 3b. First real verified site: danravekeh.com (October 27, 2026)

| Step | Result |
|---|---|
| Canonical origin | `danravekeh.com` redirects to `https://www.danravekeh.com`; verification is exact-origin, so the www origin was used. |
| Ownership | Token file committed to `danrave1234/MyPortfolio` (`v2/public/.well-known/oddhound-verify.txt`), live 42 s after the push; **Check now → verified**; re-checked automatically before the run. |
| Run | Production, **observation only**, real `muse-spark-1.3`, fresh sandboxed container. 60 model turns, 44 actions, 9 page states, $0.43. Stopped at the turn limit (truthful status). No scope or egress violations. |
| Coverage | Opened and closed every project's details view on desktop (Escape to close), then switched to a 390×844 phone and used the navigation menu. |
| Findings | No rule violations reported within that scope. Two **configuration observations**, confirmed against the live headers: no Content-Security-Policy, and no X-Frame-Options / `frame-ancestors` (only HSTS is set). |
| Follow-up made | The agent used its whole turn budget without writing a summary, so the loop now warns the model in its last 5 turns to report and finish. |

## 3c. Second site: www.estabweb.com — incident and current state (October 27, 2026)

Drave authorized active production testing ("no one using it"). Not scanned yet.

| Step | Result |
|---|---|
| File method, first try | The verification file commit failed to deploy: Vercel builds of `main` ran out of memory (SIGKILL during the Turbopack compile) since commit 9b74bf3 (April). Production kept serving 3c69dc9. |
| DNS method — **outage caused** | A TXT record on `www` (Vercel DNS) switched off Vercel's automatic address records for `www`. **www.estabweb.com did not resolve for about 11 minutes** (plus resolver negative caching of up to 10 minutes) until the record was deleted. A canary on the unused `staging` name showed that a record at `_oddhound-verify.staging` has the same effect, so a separate verification name does not avoid it on Vercel DNS. Both records were deleted; estabweb.com DNS is back to its original records. |
| Product change | DNS verification now reads `_oddhound-verify.<host>` (still accepts the bare host), and the UI warns that on auto-managed DNS like Vercel's, any record at or under the host can take the site offline, so use the file or meta method. |
| Deploy fix | Reverted 9b74bf3 on EstabWeb `main` (it also needs migration 021). `main` now equals live 3c69dc9 plus the verification file; the build succeeded and the file is served. |
| Scan run 7bf3f18c | `failed` after 11 s: it started during the DNS outage, so the egress proxy could not resolve the host. $0.005 spent; container destroyed and confirmed. |
| Next | Ownership check with the file method and the active scan. Both are waiting on Drave: the session's safety check blocked the ownership request. |

## 4. Spec gates (R0–R7) — where this build stands

| Gate | State |
|---|---|
| R0 spec alignment | Followed `docs/spec`. Deviations listed in §6. |
| R1 browser permission/network lab | **Local proof done**: allowed active flows work; private/metadata/ULA/loopback/control-port/UDP/direct-TCP blocked inside the real browser image; scope policy blocks off-origin navigation, writes to unverified origins and sockets. Redirect hops are enforced by the egress proxy + post-action origin check (route handlers alone are not relied on). Not done: WebSocket byte accounting per message, exact NIC-level byte bounds. |
| R2 fresh-Machine deployed lifecycle | **Local equivalent done** (fresh container per run, sandbox verdict, destroy + confirm, orphan reaper). **Fly not exercised**: `FlyMachineRuntime` is written against the Machines API but untested — no Fly token. |
| R3 Meta + queue + ledgers | Real Meta loop ✅, BullMQ-on-Postgres locally ✅, atomic spend/admission under races ✅. Hosted Postgres/queue not exercised. |
| R4 autonomous discovery + verified defect | ✅ on the demo target with the real model (runs 1, 5, 6). |
| R5 evidence/workspace/tenant + fixed retest | ✅ locally (tenant isolation over HTTP, escaped evidence, fenced briefs, unchanged-assertion retest). |
| R6 two real verified sites + public demo | ⏳ **1 of 2 real sites done.** `https://www.danravekeh.com` verified by the `/.well-known` file method (token committed to the MyPortfolio repo) and scanned with real Muse Spark in observation-only mode — see §3b. EstabWeb still needs a staging copy (its deployments sit behind Vercel's sign-in, and production has payments, emails, AI calls and domain registration). Public deployment still open. |
| R7 submission artifacts | ❌ Open (video, deployed URL). |

## 5. What is NOT done / not verified

- **Not deployed.** No Fly token, so neither `oddhound-web` nor `oddhound-browser` runs anywhere public. `infra/fly/*.fly.toml` and `apps/web/Dockerfile` are written but **untested**.
- **Fly per-run Machines untested** (`packages/core/browser/fly-runtime.ts`).
- **GitHub sign-in untested** (no OAuth app). Local testing used the dev-only email sign-in, which is disabled when `NODE_ENV=production` (verified: `next start` hides it).
- **Second real site not scanned yet** (B15). danravekeh.com is verified and scanned; EstabWeb needs a staging copy that is publicly reachable and isolated from production data before it can be verified.
- **Mailbox/OTP sign-ups, external SSO, CAPTCHA/MFA** are not supported; such workflows show as blocked.
- **axe/Lighthouse/SEO checks, ZAP, CSRF/CORS/framing/XSS probes** — not implemented (P1/P2 in the spec).
- **Demo video** — not started.
- Model behaviour varies run to run (see §3); five of the seven real runs produced verified findings, and the failures were caught rather than reported as success.

## 6. Deviations from the spec (deliberate)

- **Drizzle not used**: plain SQL migrations + `pg` for transparent row locking in the ledgers.
- **UI tokens/icons live in `apps/web/ui`** rather than `packages/ui` (single consumer).
- **Local runtime is a container, not Chromium on the Windows host**: Kaspersky on this machine injects a script and an overlay into every plain-HTTP page Chromium loads on the host, which corrupted evidence. The containerised browser on an isolated network is unaffected and matches the deployed design.
- **`fill_form` tool**: batches several fills into one ledgered action (spec §8: "batch safe form fills"); submit remains a separate click. Needed because Muse Spark issues exactly one tool call per turn.
- **`reasoning_effort: "low"` and a 4,000-token output cap**: Muse Spark's hidden reasoning counts against `max_tokens`; a 300-token cap returned `finish_reason: "length"` before any tool call.

## 7. How to run

See the repository README. Requires Node 26, pnpm 11, Docker. `node tests/lab/lab.ts up` starts Postgres and both demo-target builds on an isolated network; then run the worker (`node --env-file=.env apps/worker/main.ts`) and the web app (`cd apps/web && node scripts/next-with-env.mjs dev --port 3310`).
