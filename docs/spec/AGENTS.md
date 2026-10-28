# AGENTS.md — Oddhound

Instructions for any coding agent working on this repository (Claude Code, Codex, Cursor, Muse Code and similar). Read this file fully before changing anything.

## What Oddhound is

**Oddhound — Find what you didn't test.** An active exploratory testing web app: a developer signs in, **verifies they own a site**, authorizes testing capabilities/accounts/data, and watches a Meta-model-driven agent register, log in, change synthetic state and try unexpected actions in a real browser. The agent tries unexpected actions and turns failures into evidence-backed findings. The developer copies a fix brief into their own coding AI, and Oddhound replays the **unchanged** assertion after the fix.

It is built for the Meta Global AI Developer Hackathon (Indie Developer track). Drave is registered and has the $150 Meta (Muse) API credit. The deployed product must **genuinely work on real verified websites**; a demo-only display is not acceptable.

**Status (Oct 27, 2026; executable blocker probes):** Drave authorized code needed to verify blockers. The [kernel traffic guard](docs/WIRE_LIMIT_VERIFICATION.md) passes **14 standalone checks and 68 gateway integration checks**, including real active workflows, protected packet quotas, byte-exhaustion/browser closure and independent SQL. Earlier gateway/component results remain saved. **The CDP/native worker gate failed a shared-worker regression and is rejected as production containment**; its prior pass does not override that failure. Only B13/B25 are closed (2/27). WS preassembly memory, complete resource/application/deployed gates and actual Fly/Meta integration remain open; their credentials are not configured. No paid inference, deployment, real-site scan or public launch occurred. Preserve failed/passing evidence; [implementation readiness](docs/IMPLEMENTATION_READINESS.md) owns R0–R7.

## Timing

Drave replaced the fixed nine-day implementation calendar with proof milestones. Internal feature-freeze/submission dates are references, not authority to skip a gate. The guide-stated official cutoff remains **Nov 5, 10:00 AM PHT**, subject to B11 organizer questions.

This specification is model-neutral. It imposes no development-model assignment or cross-environment coordination. Every implementation is judged against the same product behavior and evidence requirements. The product itself still runs Meta inference.

## Where the details live

Each topic has one owning document. If documents disagree, the owner wins. If this file disagrees with an owner document, the owner document wins; fix this file.

| Need | Read |
|---|---|
| Scope/active run contract (§17), architecture, **status vocabulary (§10)**, **run limits (§8)**, proof-based build order (§19) | [MVP Build Plan](Oddhound-MVP-Build-Plan-v1.4.md) |
| Blocker status, risks, alternatives and evidence-based fallback | [Plan Audit](Oddhound-Plan-Audit-v1.4.md) |
| Model endpoints, adapter rules, **browser isolation and egress** (§5–6) | [Provider & Deployment Plan](Oddhound-Provider-and-Deployment-Plan-v1.4.md) |
| Security cases SEC-01–11 and Oddhound's own tests SELF-01–23 | [Security Test Plan](Oddhound-Security-Test-Plan-v1.4.md) |
| macOS-inspired UI, icons, accessibility, setup and verification flow | [UI/UX Standards](Oddhound-UI-UX-Standards-v1.4.md) |
| Demo video (separate `demo-video/` project only) | [HyperFrames Demo Plan](Oddhound-HyperFrames-Demo-Plan-v1.4.md) |
| Readiness verdict and all-blocker R0–R7 proof crosswalk | [Implementation Readiness](docs/IMPLEMENTATION_READINESS.md) |
| Historical component evidence and closure limits | [Code Verification](docs/BLOCKER_CODE_VERIFICATION.md) |
| Current gateway comparison, rejected CDP candidate and next proof tasks | [Gateway Verification](docs/GATEWAY_BLOCKER_VERIFICATION.md) |
| Protected kernel packet quotas, actual transfer/connection tests and guard integration | [Wire Limit Verification](docs/WIRE_LIMIT_VERIFICATION.md) |
| Open-source code/design references and owned evaluation-app candidates | [Open-source References](docs/OPEN_SOURCE_REFERENCES.md) |
| Source for any `[P…]`, `[T…]`, `[FLY…]` or other citation | [Research Register](Oddhound-Research-Sources-v1.4.md) |

`archive/` is history; never build from it.

## Architecture in one picture

```text
Internet -> oddhound-web: Next.js/API/SSE + trusted worker (platform keys)
                |-- PostgreSQL: app/auth/outbox/queue/leases/action+spend ledgers
                |-- private artifacts and Meta inference adapter
                |-- Fly API: create one fresh pinned Machine per run
                |  private 6PN, known per-run control path/address
                v
           oddhound-browser: separate app, NO platform keys/public service
             new Machine, no persistent volume/profile/snapshot reuse
             Playwright + non-root sandboxed Chromium
             fixed policy candidate + smokescreen + nftables
                v
           verified UI + independently verified first-party API scopes
           public resource dependencies carry no action/probe authority

bounded finalization -> destroy/confirm Machine; independent orphan reaper
```

## Fixed requirements (do not change without Drave's say-so)

**Product and authorization**
- A real product. Any GitHub-signed-in user may scan a **public HTTPS origin they have verified**: a DNS TXT record `oddhound-verify=<token>`, the file `/.well-known/oddhound-verify.txt` or a `<meta name="oddhound-verification">` tag. **Re-check the token at the start of every run.**
- Unverified URLs and private, internal, link-local, metadata or 6PN addresses are **always refused**, even when a verified hostname resolves to one.
- The agent interacts with the verified UI origin. Normal requests/direct probes to another first-party API need that API origin independently verified and explicitly scoped; API scope is not unrestricted UI navigation. Other origins are resource-only. Never auto-expand scope from a page, redirect, CORS header or network log.
- **Active testing is the core.** Run-level grants allow registration/login and synthetic create/edit/cancel, boundary values, repeats and unusual ordering without a click script or per-click approval. Permit approved write methods. Enforce origin/actor/fixture/capability/denied-effect/budget boundaries outside the model. Observation-only is optional; production active writes require explicit owner permission and suitable test data/accounts. Generic browser code cannot guarantee the business effects of arbitrary GETs or UI actions (MVP §17).
- Also ship a sign-in-free **demo target** (Oddhound's own seeded app with labelled defects) and a read-only **demo replay** of a real recorded run.
- Quotas are P0, because real users spend the $150 credit:
  - no per-user daily run count (removed Oct 28, 2026, owner decision); one queued run per user;
  - 1 run per site at a time;
  - a daily public spend ceiling with an admin kill switch;
  - a $2 per-run model cap reserved before each call;
  - ≤ 1 agent action per second;
  - an identifiable user agent `Oddhound/1.0 (+<site>/bot)`, never stealth.
- Verified-site mode opens only after all applicable **SELF-01–23** pass for enabled capabilities (MVP §16). Live anonymous demos need their applicable platform/fixture/budget gates too. Until then verified sites are allowlisted, never unverified. A disabled optional feature needs evidence its entry point is disabled; core controls cannot be skipped.
- Anonymous demo calls use the public ledger and admission limits, never the $15 judging reserve. Only authenticated admin/judge grants may spend reserve funds or gain judge priority. Enforce $50 public lifetime and $7 daily ceilings atomically, including outstanding/unknown reservations; SDK retries are explicit budgeted attempts (MVP §8).

**Browser isolation and enforcement**
- Use **one fresh pinned Fly Machine per run in the separate `oddhound-browser` app**, with zero platform credentials, no public service/IP and no attached persistent volume. Target test credentials/sessions necessarily exist there. No reused, resumed or suspended Machine/profile for another run. E2B is a fallback candidate only after the same gates and explicit owner-document review.
- The controller pre-generates the random run `wsPath` and receives the exact private Machine address from Fly. No browser DB connection or endpoint that reveals the path. Bind control to 6PN, restrict sources to trusted web Machines and leave `connect.exposeNetwork` unset. Never expose control/configuration secrets in logs/UI.
- Non-root Chromium with `chromiumSandbox: true`; actual UID launch + saved sandbox verdict. No silent `--no-sandbox`; degraded profiles are separate and not automatically cleared for public active testing.
- All browser egress through loopback-bound smokescreen (`--proxy-server` and `--proxy-bypass-list=<-loopback>`) plus browser/proxy UID firewall rules. Block private/internal/metadata/6PN, direct traffic and unsupported UDP; preserve only exact DNS/proxy/control exceptions. No upstream-selection or IP-filter bypasses.
- Fresh role/device contexts with `serviceWorkers: 'block'`; separate accounts/test data and positive identity controls. No arbitrary model-generated eval/shell/code. The fixed policy is trusted runner instrumentation, not a second browser stack.
- Prove the Playwright/CDP interception candidate before enabling it: every redirect/new target/frame/API scope, permitted writes, socket policy and hook interaction. `context.route()` alone skips later redirect hops. A policy that blocks all legitimate active flows fails. mitmproxy is a fallback candidate with explicit TLS/evidence limitations, never an unreviewed silent switch.
- Workers lack CDP Fetch, and the native URL workaround **failed another shared-worker canary test**. That CDP candidate is rejected as the production action boundary; a policy `blocked` event did not prove enforcement. Keep it only as local comparison/failure evidence. The tested gateway alternative permits approved page/worker APIs/sockets and blocks resource-frame authority borrowing. Its complete resource/deployed gates remain pending; no silent production switch.
- The later kernel guard passes 14 standalone checks and 68 guarded-gateway integration checks. It caps admitted target IP bytes, fences both directions and closes the local browser on exhaustion. It is not an exact NIC-arrival/provider-billing bound: in-flight/dropped/queued data exists. See [current traffic proof and remaining WS/deployed gates](docs/WIRE_LIMIT_VERIFICATION.md). Earlier workflow/egress/combined passes do not override the CDP worker failure.
- Helpers pin validated public addresses at the actual dial, keep TLS verification and bound requests/decompression; verification follows no redirects. Each active API has separate ownership proof. Resource requests do not grant action authority.
- Fence/close on stop/expiry, destroy and confirm Machine state, and run an independent orphan reaper outside the run worker. Failed deletion remains visible; do not call it `terminated` or assume the slot is free. Reserve bounded compute separately from model spend. Provider §5–6 owns details; MVP §8 owns canonical limits.

**Models**
- Real Meta inference is part of the product. **Primary: Direct Meta `muse-spark-1.3`** (Standard mode, `https://api.meta.ai/v1`).
- Backup: the Baseten event alias exactly `meta-models/muse-spark-open-1026` (only once `/v1/models` lists it), or Fireworks `accounts/fireworks/models/muse-spark-open`.
- The backup is a **different model** (Muse Spark Open). Evaluate both on the same tasks, and record failover as a model change.
- Adapter rules:
  - `tool_choice: "auto"` only;
  - end the loop with a `finish_run` tool;
  - screenshots go in a **`user` message after the tool result**, never in the tool message;
  - structured output comes from **tool-call arguments validated with zod**, not `response_format`;
  - never send `stop`, `logit_bias`, `logprobs` or `n>1`;
  - set temperature explicitly;
  - replay the assistant `tool_calls` message exactly.
- Model keys, passwords, cookies and tokens never go into prompts. Use credential references.

**Stack floors**
- Node 26 (Current on Oct 27; scheduled to enter LTS Oct 28). Use a pinned Node 26 build/runtime, not the host's Node 22.
- `next` ≥ 16.4.3 and `react`/`react-dom` ≥ 19.3.1 (critical RCE advisories, Oct 2026).
- `playwright@1.64.1` with the same version in the browser image.
- `@modelcontextprotocol/client` 2.x. **Never** install the legacy `@modelcontextprotocol/sdk`.
- One PostgreSQL (Drizzle 0.45) for data, auth (better-auth, GitHub with the `user:email` scope) and queue (**BullMQ 6 Postgres backend**). Local 6.4.2 probe passed; actual hosted integration is still pending. Apply explicit queue migrations and use a direct/session connection for LISTEN. **No Redis, no ioredis**, including fallback; use pg-boss only after its own probe.
- Context7 over remote HTTP with an API key. Cache lookups; a Context7 failure must never break a report.
- `pnpm` workspaces; `pnpm audit` in CI (fail on high/critical).
- No LangChain, second agent framework, second browser stack (Browser Use, Stagehand, WebdriverIO), Kubernetes, graph DB or vector DB.

**UI**
- **Apple/macOS-inspired** three-pane workspace: translucent sidebar, compact toolbar, segmented controls, resizable panes, evidence inspector. Original hound branding. Do not redesign.
- **No Lucide anywhere.** shadcn generates Lucide imports by default, so rewrite each added component to the local `Icon` layer (`packages/ui/icons`: curated `@primer/octicons-react` + original SVGs), or use the Radix primitive directly. A lint rule bans `lucide-react`.
- Site verification is the first setup step. The landing page offers **Scan your site**, **Try the demo target** and **Watch a demo replay**.

**Truthfulness**
- Use only the canonical status values in MVP plan §10. Do not invent new ones.
- Original assertions stay fixed on retest. No auto-healing that turns a failure into a pass.
- A finding is `verified` only with saved evidence that contradicts an explicit rule. "No failures" means "none in the tested scope".
- Fix briefs separate observations from hypotheses, never invent file paths or framework versions, and delimit page text as untrusted.
- Activity logs state facts. Never show invented model "thinking", fake Live badges or fabricated metrics.
- HyperFrames lives in `demo-video/`, entirely separate from the app. Video shows real recorded runs only.

## Build order (proof gates; local fixture slice started)

1. **R0:** align the active-testing specification and proof requirements; Drave explicitly starts implementation.
2. **R1/R2:** prove active allowed/denied browser policy in a canary lab and the deployed fresh-Machine sandbox/control/egress/destruction lifecycle.
3. **R3:** actual Meta loop, hosted queue, action/generation fences and atomic spend/compute controls. Existing local queue proof is only component evidence.
4. **R4:** autonomous signup/login/workflow discovery, unexpected in-scope writes, independently verified defect and valid controls, without seed knowledge/click scripts.
5. **R5:** evidence/workspace/tenant/secret/report protections and fixed-assertion external fix/retest; retain macOS UI.
6. **R6:** two real verified sites (including a genuine active account/write workflow), signed-out entry checks, all enabled applicable SELF-01–23 and public budgets/fixtures/replay.
7. **R7:** truthful footage, provenance, rules/access and submission checks.

The full B01–B27/SELF crosswalk, closure records are in [Implementation Readiness](docs/IMPLEMENTATION_READINESS.md); MVP §19 owns build order. Review each complete slice before widening exposure. Never trade active exploration, ownership/egress, fresh-run isolation, credentials, quotas, evidence or fixed retests for calendar progress.

## Repository layout (target)

```text
apps/web          Next.js UI + API + SSE (oddhound-web)
apps/worker       orchestrator + queue consumer (runs in oddhound-web)
apps/browser      disposable-run browser image (no platform keys): Playwright server, smokescreen, nftables
apps/fixture      demo target with labelled defects + corrected version
packages/contracts, db, agent/providers, browser-runtime (create/destroy/reaper), browser (policy-checked tools),
         checks, integrations (MCP/Context7), reports, ui/{tokens,icons}
demo-video/       separate HyperFrames project (npm, own lockfile)
docs/             planning docs move here when the repo is created (see MVP plan §18)
```

## How to work here

- After Drave starts implementation, make small complete changes with meaningful allowed/denied tests and reviewable evidence. Do not start a general framework.
- Before network-capable code, re-read MVP §17, provider §5–6 and security §8. Readiness is a plan, not a runtime security certification.
- Use recorded model replies in unit tests. Real provider calls are explicit, budgeted smoke tests, not hidden in every test run.
- Never execute model-generated code in the runner. Export tests from trusted templates and validated action records.
- Commit lockfiles and the browser image digest. Record versions in `docs/VERSIONS.md` and smoke results in `docs/PROVIDER_SMOKE_TESTS.md`.

## Reporting after every slice

Report:

- changed files;
- tests run and their actual results;
- exact provider/model/runtime versions;
- the Chromium sandbox verdict;
- remaining blockers (by Plan Audit ID);
- assumptions;
- missing credentials or access;
- **anything mocked**.

A documented feature, an installed package or a configured model name is not a working integration.

Never claim a security test passed when it was blocked, a run completed when its budget expired, or a video showed a live run when it was recorded. Never put credentials in prompts or publish private traces.
