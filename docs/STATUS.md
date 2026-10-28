# Oddhound (Claude build) — status report

**Date:** October 27, 2026 · **Repository:** https://github.com/danrave1234/oddhound-claude · **Spec followed:** `docs/spec/` (copy of the shared planning documents)

This is an honest record of what was built, what was actually tested, and what is still open. Nothing here is a security certification.

## 1. What works today (tested)

| Capability | Evidence |
|---|---|
| **Development model (from Oct 28, owner-approved)** | The deployed worker uses `muse-spark-1.3-contributor`: the same Muse Spark 1.3 at $0.10 / $0.002 cached / $0.20 per 1M tokens (vs $1.25 / $0.15 / $4.25), which Meta labels "Used to improve our products". Run prompts contain target-site page text (no credentials), so it is only for Oddhound's demo target and the owner's own sites. Set by `META_MODEL` in `infra/fly/oddhound-web.fly.toml`; **remove it before other owners' sites are scanned.** |
| **Stuck clicks, repeats, site map, turn limit (Oct 28)** | StudyBoost run e6b33f9c spent 57 of 60 turns on one page: "Pin note" failed 7 times with a bare 5-second timeout. Now a click on a disabled control is answered at once with that reason, a click under a dialog names the dialog, and a batch repeating a step that already failed twice is refused before it runs. Runs start from the pages the site lists (robots.txt, its sitemaps or `/sitemap.xml`, first-page links), read from inside the run's browser, same origin only. Model turns per run raised from 60 to 200 (owner-approved); the $2 and 15-minute caps are unchanged. Tested with a scripted provider in `tests/integration/stuck-click.test.ts` (not Meta inference); not yet tried on a live run. |
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
| Unit + integration (SSRF policy, egress proxy incl. rebinding and byte/request caps, scope decisions, ownership verification against a live server, ledgers under races, fencing, durable events, report fencing, export template, scenario soundness, credential vault, detectors, scout, stated rules, scenario batches through the worker pipeline, batch retest) | `pnpm test` | **167/167 pass** (Oct 28, branch `behavioral-families` rebased on main ce3e2ef) |
| End-to-end lab, offline test double (deterministic, no paid calls) | `node --env-file=.env tests/e2e/run-e2e.ts` | **all checks pass** (Oct 28, default batch mode, incl. the five behavioral families) |
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

## 3c. Scout, scenario batches and surprise-driven inference (R4, October 28, 2026)

Implements MVP §7 "Scout, scenario batches and surprise-driven inference" and §8 item 7 (branch `scout-batches`).

| Part | What it does | Tested by |
|---|---|---|
| **Scout** (no model) | After every action `snapshot.ts` lists links, buttons, fields, ARIA widgets (tab, menuitem, switch, slider, option, combobox…), editable regions, draggable items and pointer-only click targets, with disabled/checked state and owning region. It also records the rules the page states about itself: `required`, `min`/`max`, `step`, `minlength`/`maxlength`, `pattern`, input `type`, `novalidate` forms, fields the browser marks invalid, and limits written in the page text ("up to 8 guests"). | `tests/integration/scout.test.ts` (real Chromium), `tests/unit/scout-batch.test.ts` |
| **Hunter** (Meta model) | `run_scenario_batch`: up to 15 steps toward one goal, each with an optional expectation (`outcome` accepted/rejected, `text_visible`, `text_absent`, `path`). `drag` tool; arrow/Home/End keys for sliders and tabs. Fill values can be boundary templates (`{past:max}`, `{on:maxlength}`, `{blank}`…) that Oddhound computes from the field's stated rule. | unit + `tests/integration/batch-runner.test.ts` |
| **Runner** (no model) | Each step goes through the same dispatch as a single action: validation, scope policy, 1 action/s, action ledger, detectors. It returns to the model only on a surprise: failed or undecidable expectation, stale element, new page state without an expectation, detector signal, dialog, blocked request to the site itself, or budget threshold. A stale ref is re-found only by an exact, unique kind+label match. Blocked third-party writes (analytics beacons, injected scripts) are enforced and logged, but are not surprises. | `batch-runner.test.ts` (real Chromium + PostgreSQL) |
| **Stated rules** | New baseline rule **B10**: rules a page states about its own inputs hold on submit. Findings show the page-stated provenance (e.g. `page-stated: max=8 on "Party size"`). Values are typed like a user types them; nothing edits the page's HTML, and a value the browser refuses is the rule holding (tested: `maxlength` truncation, `max` refused by the browser). | `scout.test.ts`, `batch-runner.test.ts` |
| **Coverage** | Per run: controls on the pages the run reached, exercised (a browser action used them and succeeded), blocked by policy (off-site or denied by the contract), and not exercised. Shown on the run page as "N of M controls exercised" with the per-page table and its denominator; never coverage of the whole site. | unit (counting), `batch-runner.test.ts` (6 exercised, 1 blocked) |
| **Retest** | A failed expectation can be reported as `{kind:"batch", batch, step}`. Oddhound saves the recorded steps and expectations as a `batch` scenario; verification and retest replay it unchanged under the same hash rule and the same expectation judge. | `batch-runner.test.ts`: verified 2/2, *fixed* on the fixed server, still *open* on the unfixed one |

**Not built:** server-side enforcement of stated rules through a separately verified, scoped request mode (MVP §9). This build tests stated rules only through the normal user interface. The behavioural families of MVP §9 are in §3f below.

**R4 measurement.** Same demo target, goals, rules and $2/60-turn/250-action limits; real `muse-spark-1.3`; fresh sandboxed container per run (`sandbox_on`); exploration capped at $0.50 by the harness (`tests/e2e/r4-compare.ts`; not reached). "Defects" = seeded rules R1, R2, R4, R5 verified 2/2 by independent replay.

| Run | Mode | Defects | False findings | Turns | Actions | Cost | Batches (steps) / surprises | Controls exercised |
|---|---|---|---|---|---|---|---|---|
| fddb4787 | one model call per step | 3/4 (R1 R2 R4) | 0 | 58 | 43 | $0.27 | – | 9 of 39 |
| 321b6496 | scenario batches | **4/4** | 0 | 60 (turn cap) | 70 | $0.38 | 17 (58) / 9 | 23 of 48 |
| 3e6274fa | one model call per step | 2/4 (R1 R2) | 0 | 58 | 47 | $0.24 | – | 12 of 40 |
| 10dd3eff | scenario batches | 3/4 (R1 R2 R4) | 0 | 58 | 72 | $0.33 | 14 (55) / 8 | 18 of 47 |
| **Total** | per step | **5/8** | 0 | 116 | 90 | **$0.50** | | |
| **Total** | batches | **7/8** | 0 | 118 | 142 | **$0.71** | | |

**Decision: batches are the default** (`DEFAULT_AGENT_MODE = 'batch'`; `ODDHOUND_AGENT_MODE=per_step|steps|batch` overrides), because they found at least as many defects (7 vs 5). What the numbers do and do not show:

- Batching did **not** reduce model calls in these runs: both modes used almost the whole 60-turn budget. It turned the same turns into about 60% more browser actions (1.2 vs 0.78 per turn), roughly twice the controls exercised and more verified defects. Cost per verified defect was about equal ($0.10 vs $0.10); cost per run was about 40% higher, because batch results are longer.
- Batches averaged 3.6 steps, shorter than the planned 5-15. Most surprises were real signals: an expected rejection that did not happen was the seeded defect itself.
- Run 321b6496 spent 18 of its 60 turns on `report_candidate`, 7 of them refused for a missing `control_values` (the model nested it inside the scenario). Fixed before the second pair: nested or numeric control values are accepted, and repeat reports of the same rule are answered "already recorded".
- Two runs per mode on one site is a small sample, and run-to-run variation is large (per-step found 3 then 2). Not repeated on a real verified site: no locally verified real site was available, and the hosted deployment was out of scope for this branch.

Total Meta spend for R4: **$1.21**.

## 3f. Behavioral test families (MVP §9, October 28, 2026; branch `behavioral-families`)

Each family is a tool the model calls to say *what* to check; Oddhound then acts (ledgered, rate-limited, inside scope), reads the page and decides with code in `packages/core/verifier/behavior.ts`. The same functions judge exploration, the two independent replays and the retest. Every family has its own replayable scenario kind with a fixed oracle, a Playwright export, a fix-brief template and a neighbouring control. Findings record their family (`findings.family`, migration 006), contexts and limitations.

| Family | Tool | Code decides | Rule basis | Harbor defect / control |
|---|---|---|---|---|
| 1 Claim vs. truth | `check_claim` | The claimed message must be on the page after the save; saved values are looked for after reloading the landed page and reopening the record, in a fixed 4.5 s window (3 looks), recorded with the finding. | New baseline **B11** when the page claimed success; with no success message the candidate is replayed but stays `needs_review`. | D6 "Changes saved." while edited notes are dropped / the create's "Booking #N confirmed." holds |
| 2a Cross-actor | `check_cross_actor` | Only ids Oddhound saw actor A create. Oddhound signs up actor B itself with the recorded sign-up, confirms A sees its own text, guards against coincidence (B's home page), opens exactly the URL as B, presses visible controls, and compares A's record before/after. | B7. Verified only when B's own list does not show the record (privacy established by the app); otherwise `needs_review`. | D3 booking page readable by another account / its edit page refuses B |
| 2b Two tabs | `check_two_tabs` | First tab saves one field; the out-of-date tab saves another; the reopened record must keep the first change or the stale save must be refused. | Owner/demo rule (Harbor **R6**) or `needs_review`. | D7 stale save silently undoes the other tab / the same two edits in one tab |
| 3 Invariants | `check_invariant` | `sum` (a labelled total = sum of a table column) or `count` (= table rows). Numbers parsed by code (assumptions recorded); re-checked after every later step on that page. Replays use a fresh account of their own, so other scenarios' records cannot hide the error. | Owner/demo rule (Harbor **R7**) or `needs_review`. | D8 "Total guests" leaves out a booking / "Bookings: N" matches the rows |
| 4 Interruption | `check_interruption` | Oddhound submits the filled form with a second real mouse press 0.25 s later, offline during the submit (`context.setOffline`, stated as a client condition), or a reload in flight; one normal retry if nothing saved; counts the distinctive value on the list. | Owner/demo rule (Harbor **R9**) or `needs_review`. | D10 a second press while the save is slow creates two bookings / one normal press creates one |
| 5 Differential | `check_differential` | The page's main-content buttons/links and error messages on desktop vs. a 390×844 phone for the same account; digits in labels ignored, menus/headers excluded. | Owner/demo rule (Harbor **R8**) or `needs_review`. | D9 "Edit booking" hidden on phones / "Cancel booking" on both |

**Evidence (all offline, no paid inference):** `tests/unit/behavior.test.ts` (verdict functions, schemas, exports compile, fix briefs); `tests/integration/families.test.ts` (real Chromium + PostgreSQL + the real Harbor builds, recorded model replies): every family's defect is verified 2/2, every control passes and is not flagged, rule-less two-tab variant stays `needs_review`, everything flips to *fixed* on the corrected build and stays *open* on the vulnerable one. The Docker-lab e2e (`tests/e2e/run-e2e.ts`, fresh sandboxed browser container per run) checks the same with the offline test double.

**Fixed on the way:** sign-up landing on `?welcome=1` was recorded as creating record 1 (replays then "set up" with the registration form); a wrapped textarea's text leaked into its label; observation page text was cut at 120 characters by the label cleaner (1,200 intended), which hid most of each page from the model — model input per observation is now larger.

**Real Meta run (demo target, Oct 28):** run 639b0088, `muse-spark-1.3-contributor`, batch mode, `sandbox_on`, fresh container, $0.50 exploration cap (not reached): 84 turns, 171 actions, **$0.018**, 574 s, status completed. With no family names in the goals, the model called all five family tools on its own. Verified 2/2: B11 (D6), B7 via the cross-actor check (D3), R6 (D7), R7 (D8), R9 (D10), R8 (D9), plus seeded R1, R2 and R5. No false findings; the R3 control was not flagged. A rule-less two-tab check stayed `needs_review`. Two issues, both now fixed: several near-identical findings were filed twice (B11 ×2, R7 ×2, R6 ×2, because the model repeated checks), so a repeat with the same family, rule, check and page is now merged into the first candidate and counted on it; and one R7 replay was **dismissed** (a false negative), because it recreated only the run's last three bookings, and the first of those had 0 guests, exactly where D8 skips a row. R7 replays now recreate the run's records from the first one. Not retested with the model: retests replay the saved scenarios and make no model calls.

**Not done:** families 1 and 2 on a real verified site (R4 proof); Back/forward, session-expiry and mobile-continuation interruptions; differential actor A vs. actor B and before/after-fix comparisons (only desktop vs. phone); invariants beyond sum/count on a page (no "decreases by one per booking" across steps); a family column in the findings UI.

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
| Ownership | Drave approved; verified by the `/.well-known` file at 06:50 UTC and re-checked by the run. |
| Scan run 241342a0 | **Completed.** Active mode on production (acknowledged), real `muse-spark-1.3`, fresh sandboxed container (destroyed and confirmed). 48 model turns, 34 actions, 17 page states, $0.28. Desktop and 390×844 phone. Payment, domain, AI, cron, publish, redeem and admin routes were blocked by the contract; none were requested. |
| Verified finding | **R1: the contact form silently does nothing.** Replayed twice with a control, 2/2. EstabWeb's source agrees: the `/contact` form has no submit handler and its inputs have no `name`, so submitting just reloads the page. Caveat: the verifier's "observed" text says "no new record (0 → 0 rows)", which describes persistence rather than the missing confirmation; the wording should be improved. |
| Not reached | Sign-up and login never got past reCAPTCHA. Oddhound's policy blocks writes to unverified origins, so reCAPTCHA's POSTs to google.com were denied (15 times) and the site answered "bot check failed". So R3 (password errors) was **not really exercised**, no account was created, and the dashboard was not tested. Testing it needs a pre-confirmed test account supplied through the run contract. |
| Other rules | R2: invalid email rejected by the browser's built-in email check. R4: nav and footer links opened working pages. R5: phone menu opened; pricing and sign-up reachable. No violations reported. |

## 3d. Owner sign-in handoff (October 27, 2026)

Built because test accounts, staging copies and bot-check changes were too much setup for users. A run can start with a live view of its own fresh browser; the owner signs in, then hands over and the agent tests the signed-in area. Owner inputs are encrypted in transit, deleted once applied, never logged in clear or shown to the model; the session lives in worker memory for that run only. Scope relaxes only while the owner drives (denied URLs stay blocked). Safe default URL-word blocks (payments, admin, cron, domains, delete, logout) are prefilled for every run.

| Check | Result |
|---|---|
| Real-browser integration test | Pass: frames published, clicks/typing/keys relayed, signed-in cookie handed to the agent and to the phone context, no typed text in events, queue and frames emptied, cancel stops cleanly. |
| EstabWeb production run 8f5feea4 | Live view worked (137 owner inputs relayed). **Sign-in was refused by EstabWeb's reCAPTCHA v3 ("Bot check failed")** even with the owner driving, so the run was stopped by the owner: $0 model spend, browser destroyed and confirmed. Oddhound does not try to get past bot checks; sites with strict bot scoring on login need the owner's own decision on how to allow testing. |
| Local operator runs | An admin on a local development build now spends the development allocation, so those runs do not use the public 3-per-day quota. Hosted production unchanged. |

## 3e. Public deployment on Fly (October 27, 2026)

**Live:** https://oddhound-claude-web.fly.dev (web, Fly `iad`), worker and per-run browser Machines in Fly `ord`, Neon Postgres in AWS us-east-1, demo targets https://oddhound-claude-demo.fly.dev and https://oddhound-claude-demo-fixed.fly.dev. GitHub sign-in uses a dedicated OAuth app.

| Check | Result |
|---|---|
| Live demo run 31697101 (anonymous, landing page path) | **Completed.** Real `muse-spark-1.3`, 47 turns, 36 actions, $0.20. Fresh Fly Machine in the secret-free browser app, reached over 6PN, **Chromium sandbox on**, nftables applied, destroyed and confirmed (no Machines left). **All four seeded defects verified**, plus 3 configuration observations. |
| Meta availability by network | From Fly Singapore the API listed no models; from several US/AP regions `muse-spark-1.3` was intermittently `model_not_found` (Virginia 1/10, Chicago 6/8, Sydney 8/8 in one sample). The worker now retries only that unbilled 404, at most 8 attempts, each logged as `provider.retry`. This run needed none. |
| Truthful status | A model-provider failure now ends the run as `failed` (an earlier deployed run was wrongly shown as `completed`). |
| Repository gap fixed | A `.gitignore` rule (`artifacts/`) had kept `packages/core/artifacts/store.ts` and the artifact API route out of git; both are now tracked. Deployed images are built from committed code only (`git archive HEAD`). |
| GitHub sign-in | **Works on the deployment.** Drave signed in with GitHub (the OAuth password step was done by Drave, not the agent). |
| Verified-site run 1f6c5775 (www.danravekeh.com) | Project created in the live UI; new token published in the portfolio's `/.well-known` file (portfolio commit ea559d5, live ~30 s later); **Check now → verified**; re-checked by the run. Production default = **observation only**. Real `muse-spark-1.3`, 10 actions in 1 min, $0.10; Fly Machine 78124d7fde6d28, **sandbox on**, destroyed and confirmed. The agent reported no accounts or forms on the site (contact is mailto links only), so **0 verified issues within that scope**; 2 configuration observations (no CSP, frameable). |
| API origins + domain-wide DNS proof (v5/v6) | Projects can add up to 4 API hosts, each in scope only when verified and re-checked before every run (a failed re-check blocks the run). A DNS proof is accepted on the host or any parent domain (walk stops at two labels; parent DNS control implies child control), and API hosts also accept the project's site token by DNS, so one `_oddhound-verify.<domain>` record covers the site and its API hosts. File/meta proofs stay per origin. 82/82 tests. |
| Real-site active run e473ebc6 (preview.studyboost.com, staging) | StudyBoost preview (separate Neon branch, Stripe test mode) verified by DNS for the UI and its API host `preview.api.studyboost.com`. **First real-site account workflow (B15):** the agent registered a synthetic account through `/signup`, was signed in, pinned a note, browsed courses/study room/settings, and saved a profile with whitespace-only first/last names (accepted by the server). 1 min 48 s, $0.16, Fly Machine 683e04efe10278 **sandbox on**, destroyed and confirmed. **0 verified issues**: no owner rules reached this run (set by script, lost on re-render), so the whitespace-name behaviour was noted but not judged; 1 configuration observation (no CSP). |
| Run 594f56eb (same site, earlier) | **Failed honestly but labelled badly:** the first page load hit the 10 s navigation timeout (preview backend scales to zero), and the run ended as `internal_error`. Fixed in v6: first load 45 s with one retry, navigation 30 s, and an unreachable site now ends as `failed/site_unreachable`. Diagnosis on a throwaway browser Machine (destroyed) showed the egress proxy path itself was fast (~2 s cold, 0.2–0.6 s warm). |
| Open from these runs | (1) The safe-default keyword `subscription` also blocks the app's harmless **reads** (`GET /subscriptions/my-subscription`, usage history), which can degrade pages; keyword blocking should apply to navigation and writes, with GET blocking only for effectful words (logout, delete, …). (2) The agent stopped after ~2 minutes and did not use the second identity for the cross-account check. (3) Rerun with explicit rules once the daily quota resets. |
| Not yet verified on the deployment | The sign-in handoff on Fly, retest on the fixed demo build from the live UI. |

## 4. Spec gates (R0–R7) — where this build stands

| Gate | State |
|---|---|
| R0 spec alignment | Followed `docs/spec`. Deviations listed in §6. |
| R1 browser permission/network lab | **Local proof done**: allowed active flows work; private/metadata/ULA/loopback/control-port/UDP/direct-TCP blocked inside the real browser image; scope policy blocks off-origin navigation, writes to unverified origins and sockets. Redirect hops are enforced by the egress proxy + post-action origin check (route handlers alone are not relied on). Not done: WebSocket byte accounting per message, exact NIC-level byte bounds. |
| R2 fresh-Machine deployed lifecycle | **Local equivalent done** (fresh container per run, sandbox verdict, destroy + confirm, orphan reaper). **Fly not exercised**: `FlyMachineRuntime` is written against the Machines API but untested — no Fly token. |
| R3 Meta + queue + ledgers | Real Meta loop ✅, BullMQ-on-Postgres locally ✅, atomic spend/admission under races ✅. Hosted Postgres/queue not exercised. |
| R4 autonomous discovery + verified defect | ✅ on the demo target with the real model (runs 1, 5, 6). |
| R5 evidence/workspace/tenant + fixed retest | ✅ locally (tenant isolation over HTTP, escaped evidence, fenced briefs, unchanged-assertion retest). |
| R6 two real verified sites + public demo | ⏳ **2 real verified sites scanned** with real Muse Spark: `www.danravekeh.com` (observation only, §3b) and `www.estabweb.com` (active on production, 1 verified finding, §3c). Still open: a real account/write workflow (EstabWeb sign-up stops at reCAPTCHA; needs a pre-confirmed test account) and the public deployment. |
| R7 submission artifacts | ❌ Open (video, deployed URL). |

## 5. What is NOT done / not verified

- **Not deployed.** No Fly token, so neither `oddhound-web` nor `oddhound-browser` runs anywhere public. `infra/fly/*.fly.toml` and `apps/web/Dockerfile` are written but **untested**.
- **Fly per-run Machines untested** (`packages/core/browser/fly-runtime.ts`).
- **GitHub sign-in untested** (no OAuth app). Local testing used the dev-only email sign-in, which is disabled when `NODE_ENV=production` (verified: `next start` hides it).
- **No real-site account workflow yet** (B15). Both real sites are verified and scanned, but neither run created and used an account: the portfolio has none, and EstabWeb's sign-up stops at reCAPTCHA.
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
