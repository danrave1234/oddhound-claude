# Oddhound — Hackathon MVP Build Plan

**Version:** 1.4 (update 4: active testing and readiness review) · **Updated:** October 27, 2026 · **Owner:** Drave  
**Track:** Indie Developer · **Primary theme:** Push the Frontier  
**Working domain:** `oddhound.online` — optional, not purchased or verified available by this plan.  
**Tagline:** Find what you didn't test.

**Update 4 — planning only.** Active exploratory testing is the core: registration, login and permitted state changes, including unexpected inputs/order/repeats. One run-level grant authorizes bounded capability classes, not a click script. Observation-only is optional; production writes require explicit owner permission. A fresh Fly Machine per run replaces reuse/restart isolation. Additional first-party API origins must each be verified and scoped. Build by proof gates, not the former nine-day calendar. Implementation remains on hold until Drave explicitly starts it; the application still uses Meta inference. See [implementation readiness](docs/IMPLEMENTATION_READINESS.md) for the review/closure crosswalk. This update changes documentation only; no new application/probe/deployment/provider work is performed. Earlier version history and recorded local queue evidence remain valid as history.

**Apple/macOS styling stays; Lucide remains excluded.** The earlier plan versions remain in `archive/`; they are not competing instructions.

**Later local execution:** Drave authorized a barebones site and verification after update 4. The [local lab record](docs/ACTIVE_LAB_VERIFICATION.md) reports 17 passing scripted checks and their limits. This supersedes the development hold only for that local slice; the full product/launch gates and Meta runtime requirement remain unchanged.

**Subsequent clarification:** Drave requested the actual potential-blocker tests. [61 executable checks now pass](docs/BLOCKER_CODE_VERIFICATION.md), with real fixes and remaining integration/live-access requirements recorded. Meta/Fly credentials are not configured. These probes advance implementation evidence without clearing public launch or replacing the Meta runtime.

**Latest evidence overrides the earlier worker result:** the CDP/native URL gate failed another shared-worker canary test and is rejected as production containment. The [mitmproxy comparison](docs/GATEWAY_BLOCKER_VERIFICATION.md) passes 53 checks with active cross-origin worker API/socket controls and a fixed resource-frame API authority escape; relevant workflow/egress/combined regressions pass 38. Continue gateway hardening and the full proof gates before selecting/enabling production. Physical-wire/WS buffering limits and actual Fly/Meta/application gates remain open; 2/27 audit IDs are closed, with no new full runtime closure.

**Subsequent traffic proof:** [14 standalone/68 guarded-gateway checks](docs/WIRE_LIMIT_VERIFICATION.md) now demonstrate kernel packet admission quotas, actual transfer exhaustion, connection limits, preserved active workflows/SQL and browser closure. Keep the distinction between admitted bytes and physical arrivals/billing, where in-flight/queued/dropped traffic exists. WS preassembly, remaining resource/account/helper/admission/guard-fault and deployed gates remain unproved. No new B ID closes.

> Oddhound explores an authorized web application like a curious user, challenges its workflows with unexpected actions, and produces reproducible findings and fix instructions for the developer's preferred coding AI.

This is a proposed implementation plan, not a claim that the product is built. The participant guide supplied by Drave is the basis for competition requirements. External technical documentation is identified in the sources. Estimates, acceptance targets, budgets, and implementation choices below are engineering recommendations.

### Companion documents and authority

This revision supersedes v1.3 and earlier as the implementation brief. Preserve earlier versions as history, not competing instructions. Start at [README](README.md) for the doc map and reading order.

**Which document wins on conflict:** each topic has one owner. Status vocabulary, run limits and scope → this plan; UI → UI/UX standards; provider endpoints and egress → provider plan; security cases and SELF tests → security plan; storyboard and video rules → HyperFrames plan; open gates and dates of proof → plan audit. Other documents summarize and link rather than restate.

- [UI/UX standards](Oddhound-UI-UX-Standards-v1.4.md) — macOS visual system, no Lucide, honest status and consent.
- [Provider and deployment plan](Oddhound-Provider-and-Deployment-Plan-v1.4.md) — Meta/Baseten/Fireworks, smoke tests, browser isolation and egress.
- [Security test plan](Oddhound-Security-Test-Plan-v1.4.md) — target tests, proof requirements and Oddhound self-protection.
- [HyperFrames production plan](Oddhound-HyperFrames-Demo-Plan-v1.4.md) — real footage, storyboard, commands and AI-editor brief.
- [Blocker audit](Oddhound-Plan-Audit-v1.4.md) — open implementation gates and fallbacks.
- [Implementation readiness](docs/IMPLEMENTATION_READINESS.md) — documentation verdict, all-blocker proof-gate crosswalk and closure evidence.
- [AGENTS.md](AGENTS.md) — instructions for coding agents: fixed requirements, build slices and reporting rules (replaces the AI-coder handoff).
- [Research register](Oddhound-Research-Sources-v1.4.md) — supplied-guide evidence versus current official documentation.

All bracketed source IDs (G1, S, UX, P, SEC, T, H) point to that register. **No provider account, deployed application, security scan, or final video was tested in update 4.**

---

## 1. Decisions to lock

| Area | Decision |
|---|---|
| Browser | Playwright + Chromium. No custom rendering engine, second AI browser controller, stealth or arbitrary shell. |
| Agent | One bounded, provider-independent orchestrator using **Meta models**. AI proposes; tools execute; evidence and explicit assertions determine results. |
| Inference | **Direct Meta `muse-spark-1.3` Standard is primary** (changed in v1.4). Baseten's event alias is the preferred backup and sponsor showcase once confirmed; Fireworks is the alternate. One primary and one tested backup, not three calls per action. See the provider plan for the API constraints every profile must handle. |
| Browser isolation | **One fresh Fly Machine per run in the separate browser app**, no platform credentials/persistent volumes, private control, non-root sandboxed Chromium, smokescreen/nftables. Destroy and confirm after each run; independent reaper. E2B is a fallback candidate if the same runtime proofs fail on Fly. |
| Browser observations | Compact snapshots, versioned element references, state differences and targeted screenshots. |
| Frontend | **Apple/macOS-inspired** three-pane workspace, workflow map/list, browser preview and evidence inspector. |
| Icons | **No Lucide.** Curated `@primer/octicons-react` behind a local layer plus original Oddhound SVGs. |
| Data | One PostgreSQL (Drizzle) for app data, events/outbox, auth and the job queue (BullMQ 6 Postgres backend); private S3-compatible artifacts. **No Redis** (changed in v1.4). |
| Plugins | Approved capabilities; direct testing libraries; Context7 MCP for documentation. External documentation outage does not block a scan or stack-neutral fix brief. |
| Security | Controlled authorization/session/business-rule checks plus contextual observations. All active probes explicitly authorized. Release gates protect Oddhound itself. |
| Launch | **Active testing on verified sites** after run-level capability/account/data authorization. Each active API origin is verified separately. Demo target and replay remain sign-in-free, subject to their applicable gates/funding. Unverified active targets and private addresses are refused. See §17. |
| Fix workflow | Copy report → coding AI fixes elsewhere → replay original assertions. No automatic repository writes in MVP. |
| Demo film | **HyperFrames**, authored with AI tools using real recordings. Separate production project, approximately 178 seconds, maximum 180 after encoding. |
| Domain | `oddhound.online` optional after purchase; provider URL remains valid fallback. |

**Non-goals:** universal pentesting, exhaustive app coverage, native-mobile coverage, CAPTCHA/MFA bypass, unrestricted public scanning, a plugin marketplace, training a model, automatic PRs, or video generation inside testing workers.

**Update 3 evidence:** documentation review found additional design gaps; the audit no longer claims all paper blockers are closed. Seven local BullMQ/PostgreSQL checks passed with real processes and a real database, with a pinned probe in `tools/blocker-probes/`. This proves local queue viability only. No Oddhound application, authenticated model loop, deployed browser or real-site scan exists yet. See `docs/BLOCKER_VERIFICATION.md` for outputs and prerequisites.

## 2. Competition requirements and calendar

### Source-derived requirements

The supplied participant guide says the project must address one of the two themes and incorporate Meta's models. It requires a public repository, permits a maximum of four participants, requires the demo to distinguish work created during the event, prohibits use of code/data/assets without rights, and requires a three-minute demo video. Its submission section includes code and live product among the judging artifacts. [G1: lines 9–15, 91–103, 192–214]

The guide says the stage-two criteria are **equally weighted**, but the actual rubric is replaced by `[table]` in the supplied text. Do not reuse earlier percentage weights or invent the missing criteria. Obtain the complete rubric and final official rules from the organizers. [G1: lines 206–214]

**New-work handling:** retain prior conversation mockups, logos, and concepts as disclosed pre-event references, not as newly created hackathon functionality. Build and document the submitted implementation during the permitted window. Keep `HACKATHON_ORIGIN.md` with original contributions, reused dependencies, prior references, and commit dates. Confirm with organizers before including prior prototype code as part of an indie entry. This plan does not assume permission to reuse it.

The guide lists sports analyzers/coaches among its sample anti-projects; the earlier PE idea is not our submission. Oddhound is proposed as a software-testing project, subject to the organizers' eligibility decisions. [G1: lines 99–103]

### Philippines time

Conversions use `America/New_York` → `Asia/Manila`, rather than treating every ET date as a fixed UTC offset.

| Milestone from guide | Philippines time |
|---|---|
| Kickoff: Oct 26, noon ET | **October 27, 12:00 AM** |
| Conservative start of Oct 27 ET building period | **October 27, 12:00 PM** |
| Agents 101: Oct 27, noon ET | October 28, 12:00 AM |
| Verifiable Agents: Oct 28, noon ET | October 29, 12:00 AM |
| Official submission: Nov 4, 9:00 PM ET/EST | **November 5, 10:00 AM** |
| Internal submission target — our choice | **November 4, 8:00 PM** |
| Closing: Nov 9, noon ET | November 10, 1:00 AM |

The event heading uses EST while the detailed schedule says ET. The guide also separately calls Oct 27–Nov 4 the building period. Use the detailed ET schedule for planning and confirm kickoff/start guidance with the organizers. This plan conservatively starts feature implementation on Oct 27 ET. [G1: lines 51–87, 192]

## 3. Product promise and MVP boundaries

**Provide URL + permitted accounts + goals → watch discovery → inspect unexpected-behavior tests → review evidence → copy a fix brief → retest.**

A URL enables visible exploration, not knowledge of every path or backend rule. Optional business requirements, roles, known synthetic records, allowed methods, reset hooks and a declared framework version improve verification. Missing prerequisites produce **not run**, **blocked** or **inconclusive**, never invented coverage.

Coverage means observed states/transitions and explicitly scheduled checks. A denominator such as 9 of 12 selected scenarios is valid; “100% of the application” is not established by crawling it. Separate security checks, functional defects, accessibility rules, SEO observations and visual suggestions.

| Priority | Deliverable | Acceptance |
|---|---|---|
| P0 | Site verification, scope, permitted actions, credential references and budgets | A user proves control of an origin (DNS TXT, `/.well-known` file or meta tag), re-checked at each run start. A run is bound to that verified origin, approved accounts/actions, an expiry and the user's quota. |
| P0 | Real Meta-driven discovery and baseline workflow | Login and a supported workflow without a hand-authored route-specific click script. |
| P0 | Unexpected actions and validation | A seeded rule violation is reproduced; correct rejection is not flagged. |
| P0 | Workflow map/list and evidence inspector | Actual saved events drive updates, status and reconnect behavior. |
| P0 | Desktop/mobile web replay | One supported workflow is tested in both profiles; real visible/usable failure evidence. |
| P0 | Core security slice | Known-record two-account read authorization on our fixture; contextual session/header observations. Other targets without fixtures show this suite as not run. |
| P0 | Fix brief and unchanged retest | Verified failure → external fix → same assertion passes, and a valid neighboring case still works. |
| P0 | Provider/runtime gates | At least one Meta profile and one isolated execution path pass real capability/safety checks. |
| P0 | Restricted MCP integration | Approved Context7 call demonstrated; unavailable docs degrade to evidence-only, stack-neutral report. |
| P0 | Honest submission | Public repo, original-contribution record, real footage, checked HyperFrames export, and judge access that works signed out (§17). |
| P1 | Selected axe and SEO checks | Applicable rules with provenance, no broad compliance or field-performance claims. |
| P1 | Additional role/session tests | Explicit prerequisites, small request budgets, fixture cleanup. |
| P1 | Standalone Playwright export | Trusted templates plus recorded actions/assertions; no raw model-generated executable test payload. |
| P2 | CSRF/CORS/framing/benign XSS, ZAP, richer streaming | Only after core safety and fix/retest loop pass. |
| Later | Native devices, broad APIs, PRs/CI, arbitrary targets | Separate roadmap and threat-model expansion. |

If the schedule slips, narrow the supported workflow and optional scanners. Do not weaken evidence, permission checks or the original test to make a demonstration pass.

## 4. User journey

### Setup

Sign in, verify the UI origin and any first-party API origins, identify staging/production, then provide goals, explicit rules and permitted test accounts or a synthetic registration identity namespace. Approve a concise run contract: capability classes, owned test data, forbidden operations, reset/cleanup, dependencies, limits and expiry (§17). Active testing is the recommended testing mode once this permission is granted. Observation-only is an explicit optional choice.

Example: register/log in, create/edit/cancel synthetic bookings, test input boundaries and unusual ordering, but no real charges, customer messages, publishing or admin changes. The owner does not list each click, path or negative input. A production run needs explicit write permission and appropriate accounts; staging supports broader exploration with test-mode integrations and resettable data.

### Discovery and active testing

In a fresh isolated Machine the agent discovers the real interface, establishes a baseline workflow and chooses bounded unexpected actions. Approved POST/PUT/PATCH/DELETE requests are allowed; a policy that prevents all writes does not implement Oddhound. Account registration is a real workflow, not a renamed pre-seeded login. Passwords/email codes/session tokens remain behind references. If email verification or an external authentication flow is unavailable, show that workflow's blocked prerequisite.

Learned UI paths inside the granted active scope do not need approval on every step. New origin/privilege/probe authority does. Only the owner/trusted control plane can revise scope; page text, redirects and model output cannot.

### Review, fix and retest

Persist observed actions, states and evidence. Show verified findings separately from hypotheses, blocked/untested areas and configuration observations. A valid neighboring case is a control, not another defect. The owner fixes the target outside Oddhound, then the saved original assertion is replayed against the corrected deployment; no assertion weakening or silent locator healing.

## 5. Architecture and trust boundaries

```text
Next.js/macOS workspace -> authenticated API + durable SSE
                              |
trusted worker: ownership/scope, Meta agent loop, validated tools
                action ledger, leases, budget, verification/report
          |                    |                       |
PostgreSQL data/auth/queue   Meta adapter        private artifacts
          |
Fly Machines API -> one new pinned oddhound-browser Machine per run
                    separate app; no platform keys/public service/volume
                    Playwright + non-root sandboxed Chromium
                    CDP policy candidate + smokescreen + nftables
                                      |
                    verified UI + separately verified first-party APIs
                    resource-only access to approved public page assets

finalize bounded evidence -> destroy Machine -> confirm provider state
independent reaper -> expired/orphan Machine cleanup
```

**Control plane:** authorize all projects/events/artifacts. The worker executes long tasks, not web request handlers. PostgreSQL stores durable run/outbox state, action intent/results, immutable assertions and transactional budget reservations. Scope is enforced outside the Meta model. Browser events are untrusted evidence, not permission grants.

**Browser runtime:** use a new Fly Machine for each run; no reused/suspended tenant runtime, persistent profiles or attached volume. Fresh contexts separate actors/devices during the run. Target test sessions necessarily exist there, but platform/model/DB/storage/Fly credentials do not. The controller pre-generates the random per-run Playwright path and learns the private address from Fly; no browser DB/secret-discovery endpoint. Private input rules, no client-network exposure, actual-dial egress restrictions and destruction/reaper proof are required. See [provider §5–6](Oddhound-Provider-and-Deployment-Plan-v1.4.md#5-browser-isolation-one-fresh-fly-machine-per-run). The old Chromium-only restart architecture is superseded.

**Permission design:** the active contract bounds origins, actor/data authority, capabilities, forbidden effects and resources while allowing novel paths and test inputs. It is not a universal semantic safety classifier. Safe staging fixtures and target-side permissions contain effects that generic browser code cannot predict. Production active testing uses explicit narrower grants where needed. §17 owns this contract.

**Reliability:** persist run/outbox together, dispatch stable run IDs and check lease generation before every action. A queue can redeliver; it cannot guarantee exactly-once writes to a remote website. A crash/timeout after Submit requires an independent read/reset or a truthful unknown outcome, never a blind retry. Budget/provider changes do not grant another mutation.

**Stop:** persist the fence before acknowledging it, reject new actions, cancel inference, close the browser within the canonical grace and request Machine destruction. In-flight server effects can finish. Provider failure can delay confirmed destruction; record that state, deny further actions/provisioning as appropriate, and let the independent reaper continue. Do not report a Machine terminated merely because a DELETE was requested.

**Video:** `demo-video/` remains separate with no private traces or test credentials. Development tools/models and video dependencies are not extra product-agent runtimes.

## 6. Stack and package inventory

These are selected technology families, not a guarantee of the newest patch. The research register identifies sources rechecked on October 27; other choices are retained from v1.2. Resolve actual compatible patched versions, review licenses/advisories, record `VERSIONS.md`, and commit lockfiles and browser-image digests. Avoid prereleases and mid-hackathon upgrades except necessary security fixes.

| Layer | Packages / technology | Use |
|---|---|---|
| Runtime | **Node.js 26 LTS** (Active LTS from Oct 28, 2026; Node 24 is in maintenance and is the fallback), TypeScript, pnpm workspaces | Shared language and reproducible workspace. [T5, T6] |
| Web | **`next` ≥ 16.4.3, `react`/`react-dom` ≥ 19.3.1** | App Router dashboard and control APIs. Floors set by the critical RCE advisories of Oct 14, 2026. [T7] |
| Styling | `tailwindcss` 4.x, `@tailwindcss/postcss`, a few shadcn/ui components or the Radix primitives directly | Apple/macOS-inspired Oddhound tokens. shadcn generates Lucide imports by default and has no Octicons option [T8], so rewrite each added component to the local `Icon` layer. For icon-heavy pieces, prefer the underlying Radix primitive, which ships no icons. |
| Forms | `react-hook-form`, `@hookform/resolvers`, `zod` | Validated setup forms and shared contracts. |
| Graph | `@xyflow/react`, `@dagrejs/dagre` | Workflow explorer; stable layout after initial placement. |
| Panels | `react-resizable-panels` | Resizable workspace splits with appropriate keyboard access. |
| Icons | `@primer/octicons-react`, original SVG assets | Small approved set behind a local icon layer; no Lucide or mixed icon packs. |
| Animation | `motion`, imported through `motion/react` | Restrained motion and reduced-motion support. |
| Client data | `@tanstack/react-query` | Server-state queries and reconciliation. |
| Auth | `better-auth` 1.7 | Oddhound login; GitHub sign-in with the `user:email` scope. [T12] |
| Persistence | PostgreSQL, `drizzle-orm`, `drizzle-kit`, `pg` | Typed schema and migrations. |
| Queue | **`bullmq` 6 with its PostgreSQL backend** on the same database | Long-running scan dispatch. Local probe passed on **6.4.2**. Explicit `runMigrations` deployment step; direct/session connections for long-lived LISTEN, separately bounded pools and a dedicated queue schema/DB role. Prove the actual hosted connection before release. Use Job Schedulers. Fallback: `pg-boss`; **no Redis or ioredis**, including fallback. [T9, T14] |
| Browser | `playwright` / `@playwright/test` **1.64.1**; matching `v1.64.1-noble` base/custom image digest | One Playwright stack, fresh role/device contexts inside a new Machine per run; policy candidate and actual sandbox/egress must pass their proofs. [T1, T3] |
| AI | Provider adapter with the `openai` v7 client or direct HTTP | Meta models through Direct Meta, Baseten, Fireworks; optional provisioned Modal endpoint. SDK choice does not choose the model vendor. |
| MCP | `@modelcontextprotocol/client` 2.4.x; server package only if exporting our own tools. Never install legacy `@modelcontextprotocol/sdk` 1.x. | Approved external connectors. [T4] |
| Documentation | Context7 remote MCP at `https://mcp.context7.com/mcp` with an API key | Version-aware docs for fix briefs. Free tier is 1,000 calls/month, so cache `resolve-library-id` results. [T11] |
| Mutation generation | Small deterministic corpus first; `fast-check` where useful | Seeded values and optional shrinking under safe reset conditions. |
| Accessibility | `@axe-core/playwright` | Automated checks, not certification of full accessibility. |
| SEO/performance | `lighthouse`; browser DOM checks | Sampled public-page audits. |
| Artifacts | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Private S3-compatible storage and authorized short-lived access. |
| Logs/tests | `pino`, `vitest` 5, ESLint/Prettier, Playwright self-tests, `pnpm audit` in CI | Debugging, product QA and the advisory gate. |
| Deployment | PostgreSQL + private S3-compatible storage; `oddhound-web` trusted Fly app and **fresh per-run Machines in separate `oddhound-browser` app**; smokescreen/nftables | Measure regional provisioning/active/cleanup/fixture/storage/network cost. No total-cost promise from the former always-on $20.09 subtotal. E2B is a tested fallback candidate, not a simultaneous dependency. [FLY2, FLY5, FLY7] |
| Video — separate project | Pinned `hyperframes`, FFmpeg/FFprobe, supported Chrome, official agent skills | Submission film only; local/container render first. |

**Version resolution (v1.4):** the npm registry shows Playwright **1.64.1** as the latest stable release (Oct 14, 2026). This settles the 1.62/1.63 question from v1.3. Pin `playwright@1.64.1` with the `v1.64.1-noble` image and test the pair. Do not move to the 1.65 alpha mid-hackathon. [T1, T3]

The MCP TypeScript SDK v2 is stable as split packages (`@modelcontextprotocol/client` 2.4.x). Context7's tools are `resolve-library-id` and `query-docs`. Test imports and Streamable HTTP transport against Context7 on day 1; do not mix v1 examples into v2 code. [T4, T11]

Next.js 16 and React 19 remain the selected framework lines, with the security floors above. The v1.4 recheck read the npm registry for the main dependencies [T13]; still re-run `pnpm audit` at install time, since new advisories can land during the event.

No Redis, NestJS service, Kafka, graph database, vector database, Kubernetes, LangChain, or second agent framework is needed for this MVP. Introduce them only for a measured need.

## 7. Agent design

### One orchestrator, explicit phases

`verify ownership/scope → provision → register/authenticate as permitted → observe/discover → plan → execute → verify → report → unchanged retest`

Active capability grants permit registration, login and state changes on test data; unknown UI paths inside that scope are explored rather than requiring a prewritten route script. Use a bounded state machine in our application, not a chain of unrestricted prompts. Each step checks run status, permission, time, cost, target origin, and available tools.

AI responsibilities:

- Infer the purpose of visible pages and group observed actions into candidate workflows.
- Connect approved goals and business rules to candidate scenarios.
- Select a bounded, useful next action.
- Inspect visual evidence where structure alone is inadequate.
- Summarize established failures and uncertainties.
- Retrieve relevant documentation and assemble a developer-facing fix brief.

Deterministic responsibilities:

- Execute browser actions and enforce scope.
- Capture evidence, generate known boundary cases, and maintain state.
- Evaluate explicit assertions and supported audit rules.
- Apply budgets, action limits, cancellation, and role isolation.
- Export and replay recorded tests.

### Meta models through a provider-independent adapter

Use a capability-tested Meta model profile. **Primary: Direct Meta `muse-spark-1.3` Standard.** Preferred backup and sponsor showcase: Baseten with the guide's exact `meta-models/muse-spark-open-1026` alias, once `/v1/models` confirms it. Alternate: Fireworks `accounts/fireworks/models/muse-spark-open`. The backups run Muse Spark Open, a different model from the primary, so evaluate both on the same tasks. Modal inference is optional and requires the exact endpoint/model supplied by its account. None of these integrations has been authenticated. [G1, P1–P6, P12–P19]

Choose one primary and one proven backup after smoke tests. Standard/Contributor data policies on Direct Meta do not automatically describe partner services. Project data consent and retention settings are profile-specific. Fireworks' Responses API storage differs from its default open-model handling; make endpoint/settings explicit. [P7, P14]

Application-managed messages and ordinary tool calls are the portable baseline. Structured results come back as **tool-call arguments** validated locally with zod; Baseten's Muse Spark Open has no JSON mode. Use `tool_choice: "auto"` only (Meta rejects other values), end the loop with a `finish_run` tool, and send screenshots in a `user` message after the tool result (Meta rejects images in tool messages). [P1, P15, P19] Native tool search, caching and reasoning fields are enabled only when supported and tested. Keep schema conversion, image encoding, errors and usage normalization inside the adapter.

Smoke-test text, tool/result round trip, synthetic screenshot, schema, usage, timeout and two-turn continuation. Use saved action state on failover; never re-execute an uncertain write. See the provider plan for exact configuration and tests.

Muse Wonder (`muse-wonder-1.0`, positioned for computer use, about 4.7× the output price) is worth a time-boxed 30-minute comparison on one saved task after the core loop works, not before. Wonder review and Muse Image asset creation remain optional. Do not add large-model self-hosting, speech, SAM, training or extra providers merely to increase the feature count. Keep genuine Meta inference central to the running product, not only its development tools.

### Tool contracts

Expose constrained operations, such as `observe_page`, `navigate`, `click`, `fill_fields`, `press_key`, `scroll`, `capture_evidence`, `run_input_cases`, `run_accessibility`, and `replay_scenario`.

Each operation has a schema, permission class, target policy, timeout, evidence behavior, and output-size cap. Use credential references, not passwords in model arguments. Do not expose generic `eval`, shell, package installation, unrestricted fetch, or arbitrary file reads.

Fixed internal instrumentation may inspect DOM geometry. That is different from allowing the model to execute arbitrary page JavaScript. Direct API probes and fixture hooks are reviewed, typed tools with the same destination policy and permissions as browser actions, not arbitrary fetch helpers.

A visible activity summary should describe the action and evidence, not reveal raw hidden model reasoning.

## 8. Token and speed strategy

1. Keep full DOM/network/trace data in the worker or private storage. Send concise relevant observations to the model.
2. Use element references scoped to a snapshot version. Invalidate them after meaningful DOM changes; never reuse stale references blindly.
3. Prefer changes since the previous observation, with periodic full refreshes to avoid missing state.
4. Send screenshots when testing visual layout or an ambiguous widget, not after every predictable action.
5. Reuse confirmed workflows through semantic locators and explicit preconditions. A replay failure returns to inspection, not silent selector repair.
6. Generate boundary values in code. An LLM call per input value is unnecessary.
7. Separate planning from execution. Batch safe form fills, but verify before a submit or other side effect.
8. Load only relevant tool schemas and documentation. Keep policy instructions stable to benefit from provider caching where supported.
9. Keep a compact run memory: scope, role, current state, completed scenarios, unresolved findings, and next goal. Store evidence by ID.
10. Keep caches scoped to the tenant, target version, role, and device as applicable; never share private observations across customers.

Playwright MCP and agent-browser remain references, not parallel runtimes. Keep local tool selection and compact history independent of provider-native search/caching. Only activate provider-specific optimizations after capability checks; measure real token savings. [S4, S11, S13, S14; P1–P7]

**Initial engineering limits (canonical — other documents link here):**

| Limit | Starting value |
|---|---|
| Concurrent runs | Start with 1 active run globally; one fresh Machine per run, 1 per user and 1 per active verified origin (including API origins); extra runs wait in a bounded visible queue |
| Action streams | 1 per browser page |
| Role contexts / device profiles | 2 / 2 (desktop 1440×900, mobile ~390×844) |
| Run wall-clock | 15 minutes |
| Browser actions | 250 per run |
| Model turns | 200 per run (raised from 60 on Oct 28, 2026; owner-approved) |
| Model spend | $2 per run, reserved before each call |
| Browser compute | One new pinned Machine per run, no persistent volume/profile; destroy/confirm on exit. Reserve configured regional compute allowance separately; at most 2 creation attempts per run and no replacement while an uncertain orphan consumes the global slot. Independent reaper enforces expiry/cleanup. |
| Registration identities | At most 3 newly created synthetic accounts per run within an approved identity/mailbox namespace; count successful unexpected creations too and reserve cleanup capacity. Existing supplied actors remain separately scoped. |
| Per-user quota | None (removed Oct 28, 2026, owner decision): one queued run per user; spend ceilings bound cost |
| Global spend | Daily public-use ceiling (start at $7/day) with an admin kill switch; development and evaluation tracked separately |
| Target politeness | ≤ 1 agent action per second, identifiable user agent `Oddhound/1.0 (+<site>/bot)`, no stealth |
| Target traffic | Starting caps: 1,500 HTTP requests, 6 concurrent requests and 50 MiB received per run, across all roles/devices/subresources; 8 MiB per resource. Count redirect hops, probes and resets. Slow/stop on 429/503 and respect Retry-After. |
| Resources | 100 MiB total raw/sanitized artifacts per run; bounded screenshot dimensions, pages, DOM payloads and downloads. Stop at a cap with partial evidence. Network bytes also need a proxy/host cap because CONNECT hides HTTP semantics. |
| Queue admission | At most 1 pending run per principal (including anonymous sessions), 20 pending runs globally; reject excess before creating browser work or making model calls. Queue entry expires after 15 minutes; run expiry starts at provisioning. |
| Anonymous demo | 1 live request per session per hour, 1 active demo globally, plus IP-based throttling and the same global public spend ledger; session/IP limits are friction, not a Sybil guarantee. Never spends the judging reserve. |
| Stop grace | Fence before acknowledgement, no new actions immediately, cancel inference and close context within 5 seconds; guest supervisor ends browser processes within 10 seconds. Request Machine destruction and confirm separately; cloud failure is recorded and reaped, not falsely reported terminated. In-flight server commits can finish. |

Reserve expected maximum call cost before execution and apply output-token caps. Failed and partial runs retain their findings and explain the stop reason. These are starting limits to tune from measurements, not promised coverage, duration or cost.

### Admission and spend accounting (B20/B21)

Use integer microdollars and one transactional PostgreSQL ledger. Before admission, atomically check the kill switch, UTC day bucket (display the local reset time), per-user quota, site concurrency and global queue limit. Active-origin locks are keyed by canonical origin across **all** projects/users, including separately verified APIs; acquire in a stable order and release atomically. Duplicate projects cannot bypass them. Verification is checked again after dequeue, immediately before browser work. Count an admitted run against quota; refund only if it never begins provisioning. Delayed or failed usage reconciliation is never a free run.

Before each model attempt, atomically reserve a conservative upper bound for the **serialized** input (tools/history/images included, cache misses assumed), capped output/reasoning and any endpoint fees under the selected model's recorded prices. If image/token cost cannot be bounded, do not call. Compare spent + outstanding reservations against the run, daily public, lifetime public and provider/project balances; use one stable request ID so retries cannot double-release a reservation. Unknown/timeout/disconnected usage stays reserved until reconciled. Model timeout or a changed provider never resets a run's allowance. Disable hidden SDK retries; each explicit attempt gets its own reservation. Treat missing prices as a blocked prerequisite, not zero cost. [P14, P19]

The **$50 lifetime public allocation** and **$15 judging reserve** are separate subaccounts. Anonymous live demos and public verified-site scans share the public allocation and $7/day ceiling. The public demo request endpoint cannot select a billing subaccount or priority. Only an authenticated admin/judge grant can use the reserve; visitors still need no sign-in for ordinary demo requests or replay. When public funding is exhausted, show a truthful unavailable reason and the recorded replay. Do not promise unlimited or always-available paid inference. A shared/coalesced live demo run is allowed if accurately labeled and it contains synthetic data only. The kill switch fences active calls/actions as well as new admissions. SELF-18/19 must race these paths and prove totals including outstanding reservations.

Configure a deployment's funded allocation explicitly and reconcile it with the actual provider balance. Separate deployments cannot each assume the entire shared grant is available: their allocations must be partitioned or enforced through a shared spend authority. Copying a configuration does not create additional credit.

## 9. Unexpected-behavior tests

### Real-user mode is the default

Use ordinary clicks, keyboard input, scrolling, Back, reload, tabs, and visible controls. Do not force-click through overlays, remove HTML constraints, or set hidden application state and label that a normal-user test.

When realistic input event timing matters, use sequential typing/paste/keyboard interactions deliberately rather than assuming every `fill` operation reproduces every user behavior. Do not add random “humanization” or stealth evasion.

### Controlled mutation families

| Family | Examples | Verification |
|---|---|---|
| Numeric boundaries | -1, 0, min-1, min, max, max+1, decimal, bounded large value | Compare with approved/explicit constraints and the persisted observable outcome. |
| Text | Empty, whitespace, Unicode, apostrophe, bounded long text | Correct rejection or acceptance without crash/data loss. |
| Dates | Invalid ordering, past/future boundaries where rules specify them | Explicit rule and resulting state. |
| Interaction order | Submit early, edit after error, navigate back, resubmit | Recoverability and agreed state transitions. |
| Timing | Double-submit, delayed request, refresh during save | Only with resettable synthetic fixtures and a known expected outcome. |
| Session | Logout then use a stale page | Approved session rule; request rejection or safe reauthentication. |
| Responsive | Narrow viewport, zoom/layout checks, mobile menu and submit flow | Visible, reachable required actions and reproducible geometry. |

Age 101 is not intrinsically invalid. An input's HTML maximum is evidence of a declared client constraint, not necessarily proof of the intended business policy. Rules inferred only by AI remain hypotheses. Record the rule source for each test.

`fast-check` is optional for generating/shrinking supported cases. Shrinking against a stateful application can repeat side effects; only use it with reliable resets and an action budget. [S15]

### Behavioral test families (proposed differentiators)

These families test behavior over time, across actors and against what the application claims, which page-level scanners do not. They are a design, not implemented or measured. Each runs as scout-informed scenario batches (§7) in real-user mode, inside the granted capabilities, fixtures, actor limits and §8 budgets. The model proposes; the runner observes and decides. Rules the model inferred stay hypotheses until an explicit or owner-approved rule supports them.

**1. Claim vs. truth.** After a write whose UI reports success ("Saved", "Order cancelled", a changed badge or count), the runner confirms it independently: reload, revisit the record by its URL, and where a second context is granted, view it from a fresh context of the same actor. A mismatch between the success claim and the persisted state is a candidate; it becomes verified with the before, claim and after evidence plus one safe reproduction. The model extracts what the UI claims as structured tool output. Code compares. A transient delay is retried within a short bounded window before reporting, so eventual consistency is not reported as data loss. Record the window used.

**2. Two actors and concurrency.**
- *Cross-actor access:* actor A creates synthetic records during the run, and Oddhound saves their URLs/IDs. Actor B, a separate granted account, opens exactly those URLs through ordinary navigation within the verified UI origin and tries the visible actions. Confirm A's ownership and expected visibility first. Never enumerate or guess IDs, and never touch records Oddhound did not create or the owner did not supply. Seeing A's protected synthetic content (not just an HTTP 200) or completing a denied action is the evidence. Direct API attempts belong to the separate authorized request mode below.
- *Same actor, two tabs:* edit the same record in both and save in either order, cancel in one then edit in the other, submit twice. Check for lost updates, duplicated effects and stale-page writes against the persisted outcome. Only use resettable synthetic fixtures with a known expected result (Timing row above).

**3. Invariant checks.** From the observed page, the model proposes numeric or state invariants as validated tool arguments, each citing its evidence, e.g. "cart total = sum of line totals", "seats left decreases by one per booking", "cancel restores the previous balance". The runner checks them deterministically after relevant steps, with numbers parsed by code, never by the model. An invariant is a hypothesis unless the page states it, simple arithmetic shown on the page requires it, or the owner approves it. A broken hypothesis-only invariant is reported as `needs_review`, not a verified issue. Record currency/rounding assumptions.

**4. Interruption.** Interrupt a workflow in progress with ordinary user events: go offline during a submit (`context.setOffline`) and come back, reload, Back/forward, double activation, let an approved short session expire, or continue the same flow in the mobile profile. Expected outcomes: no duplicated or half-applied effect, clear error or recovery, and no false success claim (combine with family 1). Only on resettable synthetic fixtures. Offline simulation is a client condition, not proof of server behavior under real network failure; reports say so.

**5. Differential comparison.** Run the same scenario in contexts that should agree, and compare the observable outcomes: desktop vs. mobile, actor A vs. actor B where the rules say they are equal, before vs. after the owner's fix. Code computes differences (missing required action, different persisted value, error in one context only). The model only explains differences that survive simple noise filters (timestamps, IDs, ads). A difference becomes a finding only with a rule saying the contexts should match; otherwise it is `needs_review`.

**Reporting.** Each finding keeps the §10 fields, its family, the rule source, the actors and contexts used and the limitations above. These families add to the scenario denominator; they never imply coverage beyond the scenarios run.

**Proof (R4).** On `apps/fixture`, add at least one labelled defect per family (a lying success toast, a cross-actor access gap, a lost update, a broken total, a double-submit under interruption, a mobile-only failure) plus a correct neighbouring control for each. Show the family finds the defect, does not flag the control, and replays the unchanged assertion after the fix. Then exercise at least families 1 and 2 on a real verified site with an active account workflow.

### Separate authorized request mode

A direct request that bypasses a browser restriction is a different test category. It requires explicit authorization and is labeled as such. Do not mix it into the “a normal user typed this” report.

For the first authorization check, use two owner-provided accounts and two known synthetic record IDs. Confirm ownership and expected visibility, then test only that specific boundary. Do not enumerate unknown IDs or real users' data. A 200 response alone is not proof of disclosure: verify the response actually contains the protected synthetic record.

## 10. Verification and finding lifecycle

A finding is created as a candidate. It becomes verified only when the applicable expected rule and observable outcome conflict, supported by saved evidence and a successful reproduction where safe.

### Status vocabulary (canonical)

Every document, the database, events and the UI use these values. Earlier revisions used slightly different lists per document; this table replaces them.

| Dimension | Values | Notes |
|---|---|---|
| Run status | `queued → provisioning → running → finalizing → completed / stopped / failed / blocked`, plus transient `waiting_for_input` and `stopping` | `stopped` = user cancel or budget/expiry (with stop reason). `blocked` = a prerequisite or provider/runtime gate prevented the run. `waiting_for_input` = MFA/CAPTCHA/owner action. |
| Browser lifecycle | `provisioning, ready, active, terminating, terminated` | Infrastructure detail shown in run details, not the main status badge. |
| Workflow execution | `discovered, queued, exploring, testing, blocked, completed` | |
| Scenario outcome | `not_run, passed, failed, blocked, inconclusive, skipped` | `blocked` = prerequisites missing (e.g. second account); `inconclusive` = ran but evidence cannot decide. |
| Finding verification | `candidate → verifying → verified / inconclusive / dismissed` | |
| Finding lifecycle (verified only) | `open → fixed / regressed` | `fixed` only after the unchanged assertion passes on retest. |
| Finding category | `verified_issue, configuration_observation, needs_review, suggestion` | Drives the four groups in the Findings view. |
| Client connection (UI only) | `live, reconnecting, stale` | Not a run status; shown with the last-update timestamp. |

These are separate dimensions. A workflow may be testing while already containing a verified issue. A completed run can have failures. A blocked retest is not a fixed bug. A clean scan means no failures were found within its tested scope, not that the website is bug-free.

For a useful finding, store title, category, impact, confidence, rule source, role, device profile, preconditions, ordered actions, observed result, expected result, evidence IDs, reproduction attempt results, limitations, and a stable fingerprint.

Console noise or an unrelated third-party request failure should not automatically become an application bug. Root-cause claims need source access or direct evidence; otherwise use “investigate” and describe the symptom. Security configuration observations, verified failures and design suggestions have distinct presentation. Escape/sanitize evidence in Oddhound itself; delimit untrusted page content inside copied fix prompts. No security-score or ASVS-compliance claim follows from this limited suite.

## 11. Workflow graph, state, and events

A graph node represents an observed UI state with role/device context. An edge represents an observed action and resulting transition. A workflow is a named path or subgraph, such as registration or cancelling a booking.

Fingerprint states using normalized route pattern, role, viewport class, relevant forms/headings, modal state, and a versioned structural signature. Avoid embedding secrets, PII, transient timestamps, or object IDs in the identity. Similar-looking states may remain distinct when permissions or actions differ.

The graph distinguishes observed edges from proposed unexplored actions. Render unexplored suggestions as pending affordances, not as proven navigation paths.

Persist important events with fields such as:

`event_id, project_id, run_id, sequence, timestamp, event_type, workflow_id, scenario_id, payload_version, payload`

Useful event types include `state.discovered`, `transition.observed`, `workflow.updated`, `scenario.started`, `scenario.finished`, `finding.verified`, `run.blocked`, `run.completed`, and `run.stopped`. Add `provider.selected`, `provider.changed`, `browser.ready`, `site.verified`, `site.verification_failed`, `quota.exceeded`, `scope.denied`, `scenario.blocked` and `artifact.redacted` with schema versions. Show factual provider/runtime changes, not provider marketing claims.

Use SSE for durable event updates. On reconnect, replay events after `Last-Event-ID`; fall back to a fresh run snapshot when necessary. Persist first, then notify the UI. Queue notifications and progress are not the sole source of product history.

Preview frames travel separately. For the MVP, provide a timestamped, throttled latest screenshot while the run is active. Later, replace it with an authenticated screencast channel. Do not put large images in every graph event or promise full-motion streaming when showing sampled frames.

### Minimal relational data model

| Entity | Purpose |
|---|---|
| Users / sessions | Oddhound access, using the auth library's schema. |
| Projects | Owner, target configuration, settings. |
| Target authorizations | Verified origins, scope, permitted actions, expiry. |
| Credential references | Encrypted secret pointer and role; no plaintext in run events. |
| Runs | Status, budget, target version, model/config versions, provider/runtime profile, browser Machine ID, lease and heartbeat. |
| Run events | Ordered durable activity and graph updates. |
| States / transitions | The observed application graph. |
| Workflows | Named paths and execution summary. |
| Scenarios / executions | Preconditions, mutation, fixed assertion, seed, outcomes. |
| Findings | Evidence-backed problem records and lifecycle. |
| Artifacts | Private object keys, type, retention, authorized access. |
| Tool usage | Model/MCP calls, provider request IDs, normalized usage, latency, billing estimates and cost reconciliation. |
| Action ledger | Stable action IDs, intent, execution state and result binding to prevent duplicate mutation. |
| Provider profiles | Approved endpoints/models, capability tests, privacy settings and enablement; secret references only. |

Use PostgreSQL tables and JSONB payloads; a graph database is unnecessary for this scope.

## 12. MCP and plugin design

A plugin manifest includes ID/version, capabilities, input/output schema, allowed origin classes, permission level, timeout, maximum output size, and artifact policy. Only developer-approved plugins are loadable.

| Integration | MVP treatment |
|---|---|
| Browser tools | Direct Playwright implementation behind our policy layer; same browser session for observation/execution/evidence. |
| Context7 | Approved MCP client integration; version-aware docs when known, graceful evidence-only reporting on failure. |
| axe | Direct worker library, not an unnecessary extra MCP process. |
| Lighthouse | Direct sampled job on applicable pages, isolated from agent navigation. |
| ZAP | Optional passive integration after the core is stable; no unrestricted active scan. |
| Chrome DevTools MCP | Reference/later debugging capability; do not run a competing browser controller in the MVP. |
| Repository tools | Later read-only opt-in; write operations remain outside MVP. |

Context7 provides `resolve-library-id` and `query-docs`. Query with a verified or user-declared stack version. A website's appearance is insufficient evidence of its framework version. When the stack is unknown, generate a stack-neutral fix brief; do not invent filenames or implementation details. [S16]

No website text may install a plugin, change scope, reveal secrets, or override policy. Documentation returned by an MCP server is also untrusted data. MCP is a connection protocol, not a safety guarantee. The worker executes MCP tools and translates permitted results into ordinary model tool messages, so sponsor models need not implement native MCP. Provider/dev-tool MCPs and HyperFrames creative skills remain development-only, outside scan sessions. [S4, T4, SEC12]

**References to study without adding another runtime:** Microsoft Playwright MCP for observations; Vercel agent-browser for compact references; Meta's cookbook for tool loops and usage handling. Preserve licenses/notices when reusing code and disclose the original contribution. [S4, S11, S17]

The [curated open-source shortlist](docs/OPEN_SOURCE_REFERENCES.md) distinguishes reusable foundation, observation-design references and owned evaluation applications. A self-hosted reviewed RealWorld frontend/backend pair is the preferred additional functional hold-out; Juice Shop and BrowserGym/WebArena are optional lab/research references. Do not scan their shared public demos or add another production browser/agent stack. [OSS1–OSS6]

## 13. Mobile, accessibility, SEO, and performance

Default device profiles: desktop 1440×900 and a mobile web profile around 390×844. Test selected workflows in each profile, rather than multiplying every possible test by every viewport. Add 360-pixel and tablet layouts only after the main two work.

Use fresh profile-appropriate browser contexts so viewport, input/touch settings, and browser configuration are consistent. Switching the dashboard preview does not secretly resize an in-flight test; it selects a session or queues a separate replay.

Check horizontal overflow, fixed elements obscuring controls, modal clipping, mobile menu behavior, reachable submit buttons, and keyboard focus. Geometry is evidence, not a complete design judgment: horizontal overflow can be intentional. Only report an accessibility or responsive violation when its rule/impact is supported.

A vision model may suggest improving spacing or hierarchy; label these suggestions separately from reproduced failures.

Playwright emulation is not a test of every physical phone, native keyboard, mobile Safari quirk, or embedded WebView. Real devices/Appium/WebdriverIO remain later work. [S18]

Run axe on a small set of distinct states, retaining rule IDs and locations. Automated checks do not prove complete accessibility. Run SEO checks only for pages intended to be indexed; a staging `noindex` is often intentional. Lighthouse runs separately from exploration, with environment details, because the audit navigates/measures a page and can disturb the agent. Report performance as a lab observation, not real-user field performance. [S19, S20]

ZAP's baseline command includes spidering plus passive analysis. It is not merely a log reader and should not run automatically on any production target just because the analysis is called passive. [S21]

## 14. Fix brief and exported regression test

The primary report format is Markdown with an accompanying JSON structure. No PDF generator is needed for the MVP.

Example template, populated only from captured evidence:

```text
ODDHOUND FINDING
Title / status / impact / confidence
Target deployment, route, role, device, scenario ID

Expected behavior:
[Approved rule and its source]

Observed behavior:
[What the test actually established]

Reproduction:
[Preconditions, exact steps, input, expected/actual outcome]

Evidence:
[Authorized artifact references and relevant redacted requests]

Fix objective:
[Behavior that must change; no invented source-file paths]

Implementation guidance:
[Clearly separated hypotheses; versioned documentation when available]

Acceptance checks:
[Original failing case plus a valid neighboring case]

Retest:
[Scenario ID and setup/credential requirements]

Limits:
[What was not verified]
```

The fix prompt must not encourage the coding AI to remove a failing validation check, weaken authorization, or alter the test until it passes. Include valid-input regression cases.

An exported test bundle contains the scenario, replay steps, assertions, fixture setup/reset instructions, environment-variable placeholders, dependency instructions, and README. Execute the export in a clean environment before labeling it runnable. Never include real credentials or session cookies.

Browser traces can contain sensitive DOM and network data. Keep raw traces private and access-controlled; do not assume they are fully redacted or include them automatically in public share reports.

## 15. Frontend: Apple/macOS-inspired design, no Lucide

**The canonical frontend specification is [UI/UX standards](Oddhound-UI-UX-Standards-v1.4.md).** Earlier revisions copied it here in full; the two copies drifted, so v1.4 keeps one source. If anything below conflicts with that document, the UI/UX standards win.

Non-negotiables, restated for planning:

- **Apple/macOS-inspired** three-pane workspace: translucent sidebar, compact toolbar, segmented controls, resizable center workspace, right-hand evidence inspector. Original Oddhound hound identity. Do not redesign.
- **No Lucide** anywhere: app code, copied shadcn/ui components, AI-generated additions or video assets. Curated `@primer/octicons-react` plus original SVGs behind one local `Icon` layer in `packages/ui/icons`, enforced by a restricted-import lint rule.
- Primary navigation: **Projects, Runs, Workflows, Findings, Reports**. Map and List views over the same persisted records; the graph never steals focus or reorders the selection.
- Findings are grouped as **Verified issues, Configuration observations, Needs review, Suggestions**, using the status vocabulary in §10.
- WCAG 2.2 AA target for core screens; keyboard path for setup, stop, inspect, copy and retest.
- Honest status: defined denominators, no fake Live badge, no displayed model "thinking", `Demo replay` label on prerecorded activity.

## 16. Security test scope and Oddhound self-protection

The full executable-design catalog is in [Security Test Plan](Oddhound-Security-Test-Plan-v1.4.md). It uses OWASP WSTG v4.2 and ASVS 5.0.0 as references, not as a certification claim. [SEC1–SEC2]

### Target tests

| Release | Test (security-plan ID) | Prerequisite and proof |
|---|---|---|
| Core | Known-object IDOR/BOLA-style read boundary (SEC-01) | Two controlled accounts, known private fixture, valid owner read and actual unauthorized content disclosure—not status 200 alone. |
| Core | Contextual cookie/header/error observations (SEC-04, SEC-06) | Relevant observed traffic; distinguish configuration recommendations from verified exploitation. |
| Core functional/security overlap | Approved business invariants and invalid values (SEC-05) | Explicit rules, persisted observable outcome, bounded writes and reset/cleanup. |
| Next | Role/function access and logout/session lifecycle (SEC-02, SEC-03) | Known staff endpoint or session policy; real authorization outcome with positive controls. |
| Stretch | CSRF, CORS, framing (SEC-07–09) | Owned helper origin, applicable browser/cookie behavior, reversible fixture; no conclusion from missing token/header alone. |
| Stretch | Reflected/DOM XSS canary (SEC-10) | Inert marker first; opt-in benign local confirmation without exfiltration or real data. |
| Later | Uploads, broader API probes and selected rate-control checks (SEC-11) | Small harmless fixtures, declared rules and dedicated limits. |

No automatic unknown-ID enumeration, credential attacks, broad injection fuzzing, DoS, malware, production transactions or third-party-service probing. All actionful tests need approval. The guide's no-harm/platform conditions remain binding.

### Required platform controls

Each control needs executable proof from SELF-01–SELF-23 in the [security plan §8](Oddhound-Security-Test-Plan-v1.4.md#8-oddhounds-own-release-blocking-tests).

| Risk | Required control |
|---|---|
| Unauthorized scanning | Verified target, explicit origin/action/role scope, expiry and approved fixtures. |
| SSRF and scope escape | Network enforcement on browser **and privileged helpers**, DNS/resolved-address checks, redirects, IPv4/IPv6, resource versus action scopes. |
| Host/control compromise | Fresh Machine per run in a separate app without platform credentials, non-root sandboxed Chromium, source-restricted private control with a pre-generated per-run path, destruction/reaper evidence. |
| Prompt/tool injection | Data/instruction separation, bounded schemas, permission enforcement outside model, no arbitrary installs/shell/fetch. |
| Cross-tenant leakage | Project authorization for events/artifacts/reports; private storage and short-lived access. |
| Secret/screenshot exposure | Redact textual evidence and review pixels; minimize provider inputs; raw traces remain restricted. |
| Duplicate writes | Action ledger, run/fixture leases, no blind retries or provider failover replay. |
| Budget/stop failure | Reserve model and compute separately, bound requests/actions/provisioning; fence/close/destroy on stop with independent expiry/reaper and visible failed cleanup. |
| Report/fixture attack | Escape rendered evidence, sanitize links, delimit untrusted copied text, isolate deliberately vulnerable demo app. |
| MFA/CAPTCHA | Waiting/block state or permitted owner intervention; no bypass. |

Initial artifact retention remains seven days, configurable with deletion and cleanup; this is our product policy, not provider retention. Credentials/session material follow a shorter run lifecycle where feasible. Verify deletion/revocation, including live signed URLs and run-control tokens.

The SSRF boundary is the egress proxy plus nftables on the browser app, and the same IP rules for every server-side fetch (including site-verification lookups). Browser route interception is not the sole egress control. ZAP baseline spiders the site; it is not a passive import with no extra requests. [P10–P11, T2, SEC14]

**Public-launch gate:** SELF-01–SELF-23 must pass on the deployed system for each enabled capability, including duplicate writes (06), rendered evidence (09), prompt/export safety (10), fixture isolation (11), fixed retests (12) and the new redirect/active-permission/demo/accounting controls (16–23). A disabled optional feature can be recorded as `not_run` with proof its entry point is disabled; it cannot hide a missing P0 control. The same controls relevant to the anonymous live demo must pass **before** that entry point opens: a fixed target does not protect model credit, credentials or vulnerable fixture data. Until then verified-site mode is allowlisted; the recorded replay may be public after sanitization/access checks. Allowlists reduce exposure and never waive ownership, egress or budget controls. No documentation change completes a runtime gate.

## 17. Deployment and scalability

### Domain

Use `oddhound.online` only after purchase and confirmed control. This plan has not bought it or verified availability, price or trademark clearance. Provider-generated URL is the fallback and avoids blocking the submission on DNS.

One origin initially: `/` marketing, `/app` workspace, `/api` authenticated controls/events. Configure TLS and exact OAuth callbacks for the chosen URL. The demo target is a separate origin; cross-origin security helper pages, when implemented, also have explicitly limited scope.

### Who can scan what

The deployed product scans real websites. Authorization comes from **proven ownership**, not from a fixed list of demo targets.

| Mode | Who | Target | Tests allowed |
|---|---|---|---|
| **Verified site** | GitHub-signed-in owner; public access after release gate | Verified public HTTPS UI plus separately verified first-party APIs | **Active exploratory workflows after a run-level grant**, including registration/login and permitted test-data writes. Observation-only is optional; controlled probes have separate prerequisites/permission. |
| **Demo target** | Anyone, no sign-in | Oddhound's own seeded app with labeled defects | The full suite, fixed scope |
| **Demo replay** | Anyone, no sign-in | One recorded real run, read-only | — |
| Unverified URL or private address | — | — | **Refused** |

**Verification.** Oddhound issues a token per project and origin. The user proves control with any one of:

- a DNS TXT record `oddhound-verify=<token>`;
- a file at `https://<origin>/.well-known/oddhound-verify.txt`;
- `<meta name="oddhound-verification" content="<token>">` on the home page.

Verification is exact-origin (scheme + host + port) and rechecked immediately before each run/resume; missing proof blocks that scope. The agent interacts with the primary verified UI. Normal requests to an additional first-party API need that API origin independently verified and authorized. Other origins load only as public resource dependencies, never as unverified action/probe targets. See the scope contract below.

**Verification contract (B16).** Generate at least 256 random bits per user/project/canonical HTTPS origin and verification revision. Normalize hostname/IDNA and default port once; reject URL credentials and ambiguous/unsupported forms. A DNS method reads TXT at the exact hostname; a token issued for another origin/user is invalid even if copied there. The file method requires HTTP 200 and the exact token as plain-text content after permitted surrounding whitespace. The meta method parses a real tag in the home document's `head`, never a matching string in a comment, script or body. Fetch without cookies/auth or script execution, cache-bypass rechecks, reject redirects (including a www/apex change), cap the decompressed response at 256 KiB and total lookup time at 10 seconds. A redirecting site verifies its final canonical origin separately. Network helpers pin validated addresses as specified in provider §6. Bind approval to the current verification/scope revision; check after queue wait and on resume, stop on revocation or expiry, and rotate tokens when project control changes. This is evidence of control, not a blanket authorization for every tenant, account or third-party backend on that host.

**Active testing contract (canonical, update 4).** The owner approves one immutable run revision with primary UI origin, separately verified API origins/roles, test accounts or bounded registration identity namespace, permitted capability classes, goals/rules, owned fixture namespace/IDs, denied operations/data, supported dependencies, cleanup/reset, budgets and expiry. Typical grants include register/login, create/edit/cancel test records, boundary values, repeated submission and unusual interaction order. Do not require the owner to predefine every click/endpoint/negative input, and do not blanket-block state-changing HTTP methods for active scopes. Newly discovered in-scope UI paths are permitted within the grant; new origin, actor privilege, external side effect or probe authority is not.

**Environment and side effects.** Staging with synthetic data, safe test-mode external services and reset is preferred for broad exploration. Site/role/fixture boundaries, forbidden routes/operations and request budgets enforce what generic tooling can know; browser code cannot universally predict business side effects from methods or button labels. A supplied account must not have unnecessary real-data/admin authority. Destructive record operations require established test-record binding; ambiguous ownership is blocked. Ordinary in-scope actions do not ask the owner for per-click approval. Changing authority creates a new scope revision.

**Production.** Production is not synonymous with observation-only. The owner may select active testing and explicitly enable defined writes using test accounts/data and acknowledged effects. Without that grant, use the explicitly optional observation-only mode or block write-dependent workflows. Observation-only may need a narrow authentication grant; GET is not a no-side-effect guarantee. A production run may require narrower operation mappings where effects cannot be contained. Do not silently turn the active product into a GET-only crawler. [HTTP1]

**Registration and login.** The agent must discover and exercise real registration/login, including normal form requests, permitted API calls and validation. Generated passwords and mailbox/email-code/session values are trusted credential references, not model-visible strings. The supplied identity namespace, account-creation cap and mailbox adapter constrain new accounts. A fixture must prove successful registration independently of pre-seeded login. Missing verification email/OTP/MFA or unsupported external SSO is a real blocked prerequisite, never a bypass/fake success.

**API and resource scope.** An additional first-party API needs its own proof via the same verification methods, declared methods/operation classes and actor/tenant/fixture boundaries. Frontend control, a CORS header, a discovered URL or supplied ordinary user credentials alone does not prove API ownership. API scope permits approved application requests and separately granted direct probes, not unrestricted navigation or scanning. Every active origin is locked/rechecked. Unverified CDNs may serve allowed public assets; they do not gain write/probe/navigation authority. Unverifiable provider-hosted APIs or third-party interactive identity/payment flows can block a workflow. Report this compatibility limit instead of claiming support for every verified site's login. Provider §6 owns network enforcement.

**Exploration acceptance example.** Give the agent only a booking app description, rules and accounts/registration namespace. It finds signup/login, creates a synthetic booking, changes fields, tries invalid values/step order and cancels its own test record. A corrected control still works. No defect list, ground-truth selector sequence or prewritten click script is supplied. Policy must allow these positive cases while denying private-IP/scope/data/side-effect escapes. A tool that blocks all actions does not pass a safety gate.

**Credit protection.** Real public use spends the $150 Meta credit, so per-user quotas, the daily public ceiling and the admin kill switch in §8 are P0. The status page shows when the daily budget is used up. Bring-your-own Meta key is a later option, not MVP.

**Abuse controls.** Verification, per-user quotas, one run per site at a time, an identifiable user agent, an audit log of every run (user, origin, time, mode, spend), and the ability to revoke a user or origin.

**Judges.** They can press **Try the demo target** with no account, open the **Demo replay**, or sign in and verify a site of their own. Document all three with exact URLs in the submission README, and check them signed out from another network before submitting.

**Two chosen real-site candidates (Oct 27).** Drave delegated selection. Start with `danrave1234/MyPortfolio` (public navigation/mobile/keyboard evidence) and `danrave1234/EstabWeb` (a richer web application, using an isolated staging tenant for any authenticated work). GitHub confirms owner/admin access; this is not a successful Oddhound verification. Candidate URLs from repo metadata are recorded in `docs/BLOCKER_VERIFICATION.md`. Verify final HTTPS origins and tokens before any scan; never touch customer tenants, payments or messages on EstabWeb. A separate staging deployment is preferable to testing live business data. B15 remains open until both real runs have evidence.

### Control plane and sponsors

Host the Next.js app, SSE and trusted queue consumer in `oddhound-web`. Create/destroy one fresh browser Machine per run in the separate `oddhound-browser` app, with a pinned image, private control and zero platform credentials. PostgreSQL and artifacts stay durable and separate. E2B is a runtime fallback candidate only after the same proof suite and an explicit provider-plan update; do not keep two unproven production paths. [FLY2, FLY7]

Baseten, Direct Meta, Fireworks and optional Modal inference are interchangeable only through our tested provider contract. Retain the required Meta model, known privacy profile and fixed assertions. See [Provider Plan](Oddhound-Provider-and-Deployment-Plan-v1.4.md).

Local lab access may explicitly permit only the dedicated synthetic fixture service on an isolated network; this is not a public-input exception to the private-address block.

Do not run a large open-weight model yourself or provision GPU training just to use an offer. The proposed product needs browser CPU/RAM and hosted inference; video rendering is a separate bounded workload. Verify which products a granted credit actually covers.

### Runtime gates

Prebuild and pin the browser image (`playwright@1.64.1`, smokescreen, nftables rules). Prove on the deployed system:

- the Chromium sandbox works (`unshare -Ur true`, `chrome://sandbox`);
- no platform credentials are provisioned in the browser app, image or runtime (`fly secrets list` alone is insufficient); no public IP;
- the control channel is reachable only over 6PN;
- private, link-local, metadata, 6PN and loopback destinations are blocked through the proxy and directly (SELF-01/02);
- one active lease, evidence retrieval, confirmed Machine destruction, expired/orphan cleanup and a clean new run identity work.

Record browser Machine IDs/instance generations and run expiry. An independent reaper destroys expired/orphan Machines even when the orchestrator fails; do not reuse their stopped/suspended state. Never silently disable Chromium isolation or expose control ports to make a demo work; a `--no-sandbox` fallback must be recorded and shown on `/status`. [T1, PW1, EGR1, EGR2]

### Scaling

Start with the limits in §8 (one concurrent run, one action stream per page) and per-tenant/per-target quotas. Add workers only after measuring memory, CPU, latency, queue delay, request impact, browser startup and total cost. Sandbox isolation and persisted events stay the same as concurrency grows. This is a scalable structure, not a demonstrated capacity claim.

SSE reconnect reads durable events; polling is the fallback. Sampled timestamped screenshots are enough for MVP. If a provider or runtime fails, preserve partial evidence and a precise blocked reason. Credits, a custom domain, continuous streaming and all-provider support are not prerequisites for an honest limited demo.

## 18. Repository layout and AI-coding rules

```text
oddhound/
  apps/
    web/                     # Next.js, macOS UI, control plane
    worker/                  # trusted orchestration and queue consumer (runs in oddhound-web)
    browser/                 # secret-free browser app image: Playwright server, smokescreen, nftables
    fixture/                 # demo target: seeded app with labelled defects, isolated
  packages/
    contracts/               # schemas/events/action ledger contracts
    db/                      # migrations and persistent state
    agent/
      providers/             # Direct Meta, Baseten, Fireworks; optional Modal
    browser-runtime/         # Fly browser app connection + local Docker; later per-run adapters
    browser/                 # policy-checked Playwright tools
    checks/                  # rules, mutation families, gated security cases
    integrations/            # approved MCP registry/Context7
    reports/                 # evidence, fix briefs, trusted replay templates
    ui/
      tokens/                # Apple/macOS-inspired Oddhound styling
      icons/                 # approved Octicons/original SVGs; no Lucide
  infra/                     # images, egress and deployment settings
  docs/
    ARCHITECTURE.md
    UI_UX_STANDARDS.md
    SECURITY_TEST_PLAN.md
    PROVIDERS_AND_DEPLOYMENT.md
    PROVIDER_SMOKE_TESTS.md
    IMPLEMENTATION_READINESS.md  # active-testing requirements + proof gates; planning hold
    BLOCKERS.md
    DEMO_PRODUCTION.md
    EVALUATION.md
    HACKATHON_ORIGIN.md
    ASSET_PROVENANCE.md
    THIRD_PARTY_NOTICES.md
    VERSIONS.md
  demo-video/                # separate HyperFrames project/lockfile/media
  AGENTS.md                  # coding-agent instructions
  CLAUDE.md                  # imports AGENTS.md for Claude Code
  .env.example
  README.md
  LICENSE
  pnpm-lock.yaml
```

When the repository is created, the planning documents move into `docs/` under the names above: UI/UX standards → `UI_UX_STANDARDS.md`, security test plan → `SECURITY_TEST_PLAN.md`, provider plan → `PROVIDERS_AND_DEPLOYMENT.md`, plan audit → `BLOCKERS.md`, HyperFrames plan → `DEMO_PRODUCTION.md`, the build plan's architecture sections → `ARCHITECTURE.md`, while `AGENTS.md` and `CLAUDE.md` stay at the root. Preserve `IMPLEMENTATION_READINESS.md` as the review/proof-gate crosswalk. The research register stays as `docs/RESEARCH_SOURCES.md`.

Folders are sufficient until shared packages are actually needed. Do not spend the first day building a framework. The video project is excluded from production web/worker builds; it has no access to scan credentials or raw private artifacts.

Coding agents read [AGENTS.md](AGENTS.md) (Claude Code loads it through `CLAUDE.md`). Require small complete vertical slices, documented APIs, preserved macOS design, no Lucide, validated schemas, secret references, no scope bypasses, unchanged assertions and honest reporting of mocks/unfinished work. Never execute arbitrary model-generated code in the runner. Export tests from trusted templates and validated action records.

CI: lockfile install, `pnpm audit` (fail on high/critical), restricted-import lint (no `lucide-react`), typecheck, schema/policy/provider-adapter unit tests, migration/build checks, local fixture E2E and cross-tenant artifact tests. Use recorded model replies for deterministic unit tests but separate real-provider integration smoke tests. Provider calls are budgeted/explicit, not hidden in every PR test.

Keep code, asset and dependency provenance. Public repository does not mean public secrets, raw session traces or customer captures. Newly built features and pre-event references must be distinguishable under the event guide.

## 19. Proof-based build order (replaces the nine-day backlog)

Drave has removed the fixed internal nine-day implementation schedule. Build only after an explicit start instruction; use complete proof-bearing slices rather than dates to authorize progress. The guide-stated submission deadline remains a separate external constraint (see §2/B11); internal freeze/submission targets are planning references, not reasons to skip a safety gate or claim completion.

The [implementation-readiness crosswalk](docs/IMPLEMENTATION_READINESS.md#4-proof-gates-and-blocker-closure) maps every B01–B27 blocker to these gates and defines the closure-evidence requirements:

| Gate | Build/prove | Exit criterion |
|---|---|---|
| R0 | Align product/architecture/permission/proof documents | Consistent baseline and Drave's explicit instruction to start; no code yet in this update |
| R1 | Browser permission/network lab | Real active positive controls plus private/scope/redirect/frame/API/socket/traffic denial tests |
| R2 | Fresh-Machine deployed lifecycle | Actual sandbox/control verdict, new runtime identity, stop/expiry, destroy confirmation and independent orphan reaper |
| R3 | Meta + hosted queue + atomic action/spend ledgers | Real capped provider loop, hosted reconnect, no repeated uncertain writes, budgets/kill switch under races |
| R4 | Autonomous registration/login/workflow discovery, mutations and deterministic proof | Agent finds an unseen in-scope rule violation with persisted evidence and valid controls, no click script |
| R5 | Evidence/workspace/auth/report + unchanged retest | Tenant/secret/output/retention checks; original assertion passes after the external fix with a valid control; preserve macOS UI |
| R6 | Two real verified sites, public live demo and replay, all enabled release tests | Deployed evidence and all applicable SELF gates; otherwise keep the relevant feature closed/allowlisted |
| R7 | Checked submission artifacts and rules/provenance | Actual accessible repo/video/product evidence; organizer questions resolved or explicitly outstanding |

Keep the local queue proof as prior component evidence; do not repeat it as a substitute for hosted application tests. Re-run affected proofs when runtime/policy changes. Defer optional secondary providers, scanners, extra browsers and elaborate video work while a core gate is failing. Do not cut fresh-run isolation, ownership/egress, credentials, budgets, active exploration, evidence or fixed retest semantics to make the timeline look complete.

## 20. Evaluation plan

Build a small synthetic scheduling or booking application with clearly labeled defects and a corrected version. Suggested defects: invalid numeric persistence against an explicit rule, whitespace-only acceptance, duplicate submission, mobile overlay obscuring submit, an inaccessible input, and a controlled cross-account record visibility defect.

The agent receives the application's ordinary description, authorized accounts, and business rules—not the defect list, exact selectors, or expected reproduction scripts. Keep evaluator ground truth separate from the model context, even if disclosed publicly in the repository. No repository-reading tool is needed during these runs.

Add a second authorized app or held-out variant with different routes and labels to evaluate adaptation. Report sample sizes; do not generalize a small demonstration to all websites.

| Measure | Initial acceptance target, not a claimed result |
|---|---|
| Baseline workflow | Completes 3/3 clean active runs on the primary fixture. |
| Registration/login and writes | Discovers signup/login and creates/edits/cancels synthetic records from a run-level grant, without ground-truth scripts; separately verified API-backed variant works; forbidden effects stay blocked. |
| Functional proof | At least one unseen negative-input scenario is found and reproduced. |
| Responsive proof | At least one mobile-only usability failure is independently reproduced. |
| Authorization proof | One correct synthetic two-account known-record result on the demo target; other sites without prerequisites show `blocked`. |
| Real-site proof | At least two verified real sites other than the demo target complete saved runs; at least one demonstrates a genuine active registration/login and test-record write workflow. Report a genuine finding or honest "no failures in tested scope"; portfolio navigation alone does not prove active account testing. |
| Finding precision | Every demo claim manually checked against ground truth; publish all false positives in evaluation. |
| Detection | Report detected/seeded in-scope defects, with misses and blockers. |
| Replay | At least 4/5 attempts reproduce a saved fixture failure; publish actual count. |
| Retest | Fixed deployment passes the unchanged assertion and a valid-input check. |
| Safety | Scope/egress, credential masking, artifact ownership, stop, and budget checks pass. |
| Efficiency | Record uncached/cached input, output/reasoning usage, latency, artifacts, and cost per completed scenario. |

Add negative controls: intentionally public CORS, proper rejection of invalid values, an intentionally shared record, staging noindex, a login wrapper with status 200, and a stale cached page after logout. The agent should not inflate these into verified security problems.

Keep provider and model profile in evaluation metadata. A new provider gets the same saved goals, constraints and assertion versions; compare verified task outcomes, false positives, time and total cost rather than model benchmark marketing. Evaluate fallback without repeating writes. Apply the self-protection matrix before opening targets beyond fixtures.

Compare a small rules/audit-only baseline against the agent on the same fixture. Also compare a structured-observation configuration with a screenshot-heavy baseline on a few identical tasks. Measure the differences; do not assume a token reduction percentage before testing.

## 21. Three-minute submission video — HyperFrames

**Selected tool: official HeyGen HyperFrames, operated with AI coding/editing tools.** Use it to compose **real recordings** into the film, not to generate evidence of unbuilt features. Keep `demo-video/` separate from the app and sandbox dependencies. [H1–H7]

Target 1920×1080, 30 fps, approximately 178 seconds with actual encoded duration no greater than 180. These encoding choices are ours; the supplied guide requires a three-minute demo and clearly identified new work. [G1]

The storyboard (seven scenes, 0:00–2:58) lives in the [HyperFrames production plan §4](Oddhound-HyperFrames-Demo-Plan-v1.4.md#4-storyboard-178-seconds) and is not repeated here. One conclusive failure → fix → unchanged-retest sequence is the centerpiece.

The [HyperFrames production plan](Oddhound-HyperFrames-Demo-Plan-v1.4.md) includes setup, a ready-to-paste AI-editor prompt, assets/claims ledgers, validation commands and delivery fallback. Test the rendering environment early and capture working slices throughout the build. Do not wait until submission day to discover codec, disk, missing-footage or audio-sync issues.

Keep assets local/frozen for rendering and animations seekable. Do not expose private scans to a video-generation service by default. No Lucide or unsolicited UI restyle in video assets. Narration/music licenses and optional generation costs are separate from the framework's license.

Show only provider logos/names actually used, with permitted assets. An enabled config file is not proof of integration. No fake Live badge, hallucinated findings or fabricated successful retest. Explain prerecorded replays and edits.

Suggested submission description:

> Oddhound is an AI-powered browser testing workspace for developers shipping web applications, including AI-generated apps. Developers provide an authorized URL, test accounts and goals. Meta-powered agents discover workflows, try unexpected actions and inspect desktop/mobile web behavior. Controlled checks verify findings against recorded evidence, including selected authorization boundaries when fixtures are available. Developers copy a fix brief to their preferred coding AI and replay the original scenario after the correction.

## 22. Credits, budgets and provider selection

**Confirmed by Drave (Oct 27):** registered for the event, with the $150 Meta (Muse) API credit available. **Guide-derived, not account-verified:** the partner offers below. Baseten's $100/2M TPM, Modal's $100 and Fireworks' $25/team are conditional offers with different eligibility/claim processes. Confirm applied balances, expiry, covered products and any card requirements in each account. Do not treat potential totals as guaranteed funding or a TPM grant as permission to stress a target. [G1]

Suggested allocation of the confirmed $150 Meta credit: **$45 development, $30 evaluation, $50 public use**, **$15 protected demo/judging reserve** and **$10 contingency**. Enforce the lifetime allocations as well as the $7 public daily ceiling; anonymous live demos use public funds (§8). Turn on Meta's spend-limit notification. A $2 cap is a dollar limit, not a promised token allowance: input, images, reasoning/output and cache prices differ. Reallocate only after grants actually land and reserve per model/endpoint using current documented prices. Infrastructure, storage and fixture hosting require separate funding.

Reserve the maximum permitted call cost before execution; enforce output caps, usage reconciliation and a project-wide limit. Model usage, browser hosting, storage, renderer CPU and optional audio/media services have separate budgets. Provider alerts are not a substitute for our stop controls. Exceeding a budget yields partial results and a stopped reason, not hidden retries.

Direct Meta Standard is the primary, funded by the most certain credit. Promote Baseten from backup only if the exact guide alias `meta-models/muse-spark-open-1026` succeeds, eligibility is verified, the account is past the 15 RPM unverified tier, and the agent loop works without JSON mode. Fireworks is the alternate; Modal is an optional later per-run sandbox and inference option. There is no requirement to use every sponsor or self-host a large model. Sponsor award credit applicability to a sandbox/render product remains an explicit check. [G1, P1–P17]

`oddhound.online` stays optional and unpurchased/unverified by this plan. Check price and renewal separately at purchase. A provider URL and local HyperFrames render keep the submission independent of the domain and extra service approvals.

## 23. Definition of done and open blockers

A developer supplies an authorized target, sees a real Meta-driven workflow, obtains an independently reproducible unexpected-behavior finding, inspects mobile results, understands which security checks ran or were blocked, copies a useful fix brief and replays the same assertion after a correction.

The demo target demonstrates a controlled two-account boundary. At least two real verified sites complete runs end to end, which shows the product works beyond the demo. New targets lacking role/fixture context do not inherit that coverage. Findings have rule provenance, observed outcomes, evidence and accurate limits. UI/SEO/configuration suggestions never inflate the security failure count.

One primary Meta inference profile and one isolated browser path pass their capability/safety gates. Any backup actually used is tested. Scope, secret handling, tenant access, cancellation, retry semantics and evidence retention are exercised, not assumed. Verified-site mode is public if the public-launch gate passed; otherwise it is allowlisted. Unverified and private targets are refused in every case.

The UI retains the Apple/macOS appearance and has no Lucide dependency/imports. Key tasks work by keyboard; graph/list focus and selection remain stable; actual provider/device/role context is inspectable.

The submission includes accessible code/demo/video links, original-contribution disclosures, dependency/asset notices, no secrets and a truthful HyperFrames film of real behavior. Claims, actual encoded duration and media rights are checked. A rendered marketing sequence alone does not satisfy the requirement.

**Open implementation gates are listed in [Plan Audit](Oddhound-Plan-Audit-v1.4.md).** The present work corrects the documentation; it does not certify the product, provider accounts, live tests, cost or scalability.

**First milestone:** one safe Meta-driven browser run that discovers a form, demonstrates an actual rule violation, saves evidence and replays the fixed assertion. Build outward from that vertical slice.

## Sources and verification notes

All source identifiers used in this plan (G1, S1–S25, UX1–UX10, P, SEC, T, H) are listed in the [research register](Oddhound-Research-Sources-v1.4.md). Repository licenses, exact patch versions, image digests and API access must be checked again when dependencies are installed. References are not a claim of exclusive originality or endorsement.
