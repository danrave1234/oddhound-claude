# Oddhound — Meta models, sponsors, and deployment

**Revision:** 1.4 (update 4: active testing) · **Date:** October 27, 2026  
**Status:** proposed integration design, updated after the October 27 blocker review. A local BullMQ/PostgreSQL probe has passed (see `docs/BLOCKER_VERIFICATION.md`); no authenticated model call or Fly deployment has been validated. Credit remains user-confirmed.

Sources in brackets refer to `Oddhound-Research-Sources-v1.4.md`.

## 1. Decision

Keep one Playwright browser controller and one bounded agent loop. Make **inference provider** and **sandbox provider** independent configuration choices.

Recommended candidate deployment:

- **Direct Meta `muse-spark-1.3` (Standard): primary — changed in v1.4.** It is first-party Meta, which matches the guide's pass/fail Meta-use requirement. Its $150 per-participant credit is the most certain funding. Tools and image input are documented, and per-team rate limits are high. [P14–P16, P19]
- **Baseten event alias: preferred backup and the sponsor showcase**, if `meta-models/muse-spark-open-1026` appears in `/v1/models` and the credit lands. It was dropped as primary because Muse Spark Open on Baseten has **no structured-output/JSON mode** [P1], an unverified account starts at **15 RPM / 100k TPM** [P18], and the alias is unconfirmed.
- **Fireworks `muse-spark-open`:** alternate backup. Tools, images, 1M context and zero retention by default are documented. [P5–P7]
- **Browser isolation: one fresh Fly Machine per run inside the separate `oddhound-browser` app (update 4).** No Machine/profile/volume is reused between runs. Keep platform credentials in `oddhound-web`; use private control, sandboxed Chromium, smokescreen and nftables. An independently scheduled reaper confirms cleanup. This replaces the shared-Machine restart design. E2B is a fallback candidate if Fly cannot pass the same runtime/network gates; it is not a second simultaneously deployed path. Modal remains optional, not a launch dependency. [FLY7, ALT1]
- **Different models:** the primary (Muse Spark 1.3) and both partner backups (Muse Spark Open) are different models. Failover is a model change, not just a provider change. Run the same saved evaluation tasks on both before the demo and record the differences.
- **HyperFrames:** separate video-production tooling. Local/container rendering first; a distinct Modal render job is optional, not part of testing traffic.

Activate only **one primary and one tested backup** for the final demo. Supporting configuration for more providers is useful; orchestrating all of them in every run is not. Freeze the selected paths after the first complete vertical slice.

The guide permits Meta open-weight models and identifies all three partners. Using a partner does not mean using an arbitrary model from its catalog: retain an actual Meta model and record the exact model ID in the run. [G1]

## 2. Endpoint profiles and verification

| Profile | Base URL / model | Evidence and gate |
|---|---|---|
| Direct Meta (**primary**) | `https://api.meta.ai/v1`; `muse-spark-1.3` | Standard mode ($1.25/$0.15/$4.25 per 1M; not used for training), not Contributor (used for training). 1M context. **`tool_choice` only `auto`; `stop`/`logit_bias`/`logprobs` rejected; images only in `user` messages.** Smoke-test account access. [P14–P17, P19] |
| Baseten event (backup) | `https://inference.baseten.co/v1`; `meta-models/muse-spark-open-1026` | **Model alias taken exactly from the participant guide**; the public ID is `meta-models/muse-spark-open`. Tools and images (≤8, 10 MB) supported; **no structured output/JSON mode**; `n>1` rejected. Unverified accounts get 15 RPM / 100k TPM, so verify the account on day 1 and read the `x-ratelimit-*` headers. [G1, P1–P4, P18] |
| Fireworks (alternate) | `https://api.fireworks.ai/inference/v1`; `accounts/fireworks/models/muse-spark-open` | Tools and images listed; 1,040k context; zero retention by default on Chat Completions (avoid the Responses API's `store=True` default). `json_schema` is not confirmed for this model. [P5–P7] |
| Modal inference (optional) | Per-endpoint base URL and proxy token from the account; the announcement names `meta-models/Muse-Spark-Open-816B-A42B` | Copy the exact endpoint and model ID from the provisioned account. Vision is not stated. Do not guess or silently substitute a non-Meta model. [P12–P13] |

Before the first Baseten call, list `/v1/models` with the event key. If the event alias is missing or returns an error, preserve the error class and ask the organizer/provider to confirm the alias. Do not silently strip `-1026`: it may affect access or event-credit attribution. Choose another already approved profile while that question is unresolved.

### Every enabled profile passes the same smoke suite

1. Text response with actual resolved model metadata where provided.
2. One tool call and one returned tool result; required IDs and arguments round-trip correctly.
3. A screenshot question using a synthetic page. The image is sent in a **`user` message after the tool result**, because Meta rejects images in tool messages. Verify image transport works for this exact model.
4. Structured results returned **as tool-call arguments** (the portable path: Baseten Muse Spark Open has no JSON mode), validated locally with zod, including rejection of extra or invalid fields. Test `response_format` only as an optional enhancement on profiles that document it.
5. Timeout, cancellation and a deliberately invalid request handled without executing a tool.
6. Token/usage response handling and a reconciliation check against the provider dashboard.
7. A two-turn continuation with compact history. No private provider-only state is required to resume.
8. Tool output containing hostile instructions cannot expand scope or access secrets.

Record the endpoint, date, model, request settings, test IDs, latency, errors and observed usage in `PROVIDER_SMOKE_TESTS.md`. Successful documentation lookup is not a smoke test.

## 3. Minimal provider adapter

Use a small TypeScript interface inside `packages/agent/providers`, not another agent framework. Its normalized request/result contract includes:

`provider, model, messages, tools, outputSchema, maxOutputTokens, timeout, abortSignal, toolCalls, responseText, usage, finishReason, requestId, capabilityProfile`.

A capability profile tracks image support, tools, strict schema support, image transport, context limit, usage detail, caching, optional reasoning settings and retention configuration. It is both documented and smoke-tested. Never send a provider-specific field to every endpoint merely because the endpoints accept an OpenAI-style request.

**Lowest-common-denominator rules (from the v1.4 recheck):**

- Send `tool_choice: "auto"` only. Meta rejects `required`, `none` and named tools. To end the loop, use a `finish_run` tool and re-prompt once on a plain-text reply.
- Return tool results as text/JSON. Attach screenshots in a following `user` message that references the tool-call ID.
- Get structured output from tool-call arguments plus local schema validation, not from `response_format`.
- Never send `stop`, `logit_bias`, `logprobs` or `n>1`. Don't count on `seed` or `temperature: 0` for reproducibility; determinism comes from saved actions and fixed assertions.
- Replay the assistant message containing `tool_calls` before the tool results, exactly as returned.
- Meta's default temperature is 1.0. Set it explicitly per profile and record it in the run.

Default to application-managed **Chat Completions** state. Convert MCP tools to ordinary constrained function definitions at the application boundary. The worker invokes MCP and returns the tool result; the model does not need native MCP support. Provider-specific Responses APIs, native computer-use APIs, deferred tool loading, and server-side conversation IDs are optional enhancements, not portability requirements.

Our tool names, schemas, state machine, authorization rules, evidence storage, and assertions remain provider independent. Meta's tool search works only on its Responses/Messages APIs, not Chat Completions, and can't be combined with `json_schema` [P20], so the MVP uses our local capability registry to expose a small selected set of tools. Prompt caching is automatic on Meta [P21]; keep the system prompt and tool list stable to benefit. [P1–P3, P6, P15–P17, T4]

### Safe failover

A model timeout is not permission to repeat a form submission. Persist tool intent and result under an application action ID before moving the agent forward.

- Retry a failed inference only within the budget and only when no unrecorded action may have occurred.
- If a tool executed but acknowledgement is uncertain, inspect the action ledger and target state first.
- Switch provider only at a known checkpoint; carry forward confirmed observations, tool outcomes, pending work and fixed assertions.
- Never ask the replacement provider to redo a mutation just because the preceding provider stopped responding.
- Record the provider change in the run; preserve original and rerun execution settings for evaluation.
- No silent movement of private data to a provider the project owner has not approved.

## 4. Privacy and spending are profile-specific

Do not carry Direct Meta's Standard/Contributor distinction over to Baseten, Fireworks or Modal. Their terms and endpoint settings differ. Use synthetic data until retention, logging, region and project consent are reviewed for each enabled profile.

Fireworks' documentation distinguishes its default open-model treatment from its Responses API, where conversation storage defaults on and has a retention period. This is a reason to make request format and storage settings explicit; it is not a promise that every Fireworks feature has the same policy. [P7–P8]

Never put model/API keys, raw passwords, cookies or bearer tokens in the prompt. Redact relevant DOM text and request details; review screenshots separately because textual redaction does not sanitize image pixels. The browser necessarily holds its authorized target session, but receives no platform/model/cloud credentials.

Model spend, sandbox CPU/memory time, artifacts, video rendering, and optional audio services are separate meters. Use one ledger with per-provider subaccounts. Count billed tokens conservatively, including reasoning/output usage as documented for the selected endpoint; avoid double-counting fields that are subsets. Unknown usage reserves budget rather than being counted as free. Reconcile estimates against bills; don't hard-code a dubious scraped price table.

**Starting controls:** the canonical run limits (concurrency, 15-minute timeout, 250 browser actions, 60 model turns, $2 model budget, separate sandbox compute cap and project-wide ceiling) are in [MVP plan §8](Oddhound-MVP-Build-Plan-v1.4.md#8-token-and-speed-strategy). They are engineering defaults, not measured run costs or provider limits.

## 5. Browser isolation: one fresh Fly Machine per run

**Selected planning baseline (update 4).** A separate secret-free browser app still matters, but a reused Machine plus Chromium restart is no longer the chosen isolation strategy. The controller creates a new Machine from the pinned browser image for one run, with no attached persistent volume; it destroys that Machine after finalization. This is a design decision pending the R2 deployed proof, not a completed integration. Fly exposes the required create/delete/private-address primitives. [FLY7]

```text
oddhound-web: trusted Next.js/API/SSE + worker; platform credentials
  |-- PostgreSQL: app/auth/outbox/queue/leases/action and spend ledgers
  |-- private artifact storage
  |-- Meta model adapter
  |-- Fly Machines API: fresh Machine per run, saved ID/expiry
  |
  | private 6PN control to this exact Machine and random run path
  v
oddhound-browser: separate Fly app, zero deployed platform credentials
  fresh pinned Machine, no public IP/services, no persistent volume
  non-root Chromium + Playwright 1.64.1; fresh role/device contexts
  runner-owned request/action policy + smokescreen + nftables
  v
verified UI origin + separately verified first-party API scope
approved public page resources under separate resource permissions
```

- **Secrets and threat boundary.** Fly app secrets reach all Machines in an app; never put browser Machines in the web app or give the browser app DB/model/storage/Fly keys. [FLY2] Target test credentials and sessions are necessarily present during a run. A compromised browser can expose them; use synthetic least-privilege accounts. Fresh VMs reduce cross-run persistence, but do not prove safety against arbitrary kernel/VM escape or establish network isolation by themselves.
- **Private control without discovery.** The trusted controller generates a random per-run `wsPath` and passes that ephemeral capability to the new Machine's startup configuration. The create response provides the private Machine address; the controller already knows the path. No browser DB connection and no endpoint that returns the control path. Redact provisioning/configuration bodies as well as URLs in logs. Bind Playwright to that exact Machine's 6PN address; host INPUT rules admit only the current trusted web Machine sources. A separate Fly app is not a separate 6PN by itself. Prove another org app and the browser UID cannot reach control. Never send CDP/control paths to the dashboard. Leave `connect.exposeNetwork` unset. [FLY3, FLY7, PW1, PW3]
- **Sandbox.** Launch non-root with `chromiumSandbox: true`; user namespaces and the actual Chrome sandbox verdict must be tested as that UID on Fly. A successful `unshare` alone is insufficient. A recorded `--no-sandbox` fallback is a different degraded profile, shown on `/status`; it is not automatically cleared for public active testing. If Fly cannot pass the selected profile, evaluate E2B against the same gates instead of silently weakening them.
- **Network.** Bind smokescreen only to loopback under a different protected UID. Chromium uses `--proxy-server=http://127.0.0.1:<proxy>` and `--proxy-bypass-list=<-loopback>`. nftables allows the browser UID to establish only that proxy connection, plus established control replies; drop other egress including UDP/QUIC/WebRTC and internal DNS. Proxy egress has its own private-destination denial and only exact resolver/port exceptions. Do not grant browser capabilities to alter proxy/firewall/supervisor configuration. [EGR1–3]
- **Run-local state.** Fresh contexts per actor/profile with `serviceWorkers: 'block'`, no storageState or writable home reused across runs. Role contexts within one VM are not independent hostile-tenant boundaries. Bound simultaneously open pages/contexts and clear role identity before accepting authorization evidence. Keep trusted files root-owned and run storage temporary; clean browser processes on exit even though the entire Machine will be destroyed.
- **Readiness.** No target page or target credentials before network policy, target attachment and run binding are ready. Policy failure blocks the run. A browser that opens but cannot enforce scope is not ready.
- **Evidence and termination.** Return bounded artifacts over the trusted connection for private storage/redaction; no storage credentials in the guest. Configure bounded guest exit, `auto_destroy` and no automatic workload restart; none alone is an independent TTL guarantee. Finalize within canonical grace periods, close the browser, destroy the Machine and check provider state. A reaper outside the run worker lists tagged Machines and destroys expired/orphaned ones even after worker failure. Never reuse a stopped/suspended Machine or resume its snapshot for another run. A failed delete stays visible; do not label it `terminated` or admit replacement capacity on the assumption cleanup succeeded. [FLY7]
- **Compute accounting.** The model cap does not pay for or cap VM compute. Before provisioning, reserve a conservative compute allowance from configured regional rates and the bounded lifetime/cleanup policy; bound creation retries and total live/orphan Machines. Alert/disable new provisioning when cleanup or infrastructure funding is uncertain. The former ~$20 figure was an always-on two-preset compute subtotal, not a forecast for this architecture. Measure actual startup, active time, cleanup, storage, fixture and network cost before publishing an estimate. [FLY5]

### Lifecycle

Run status and browser lifecycle remain exactly the MVP §10 vocabulary. `provisioning` now includes ownership recheck, admission, creating the fresh Machine and installing/verifying policy. Save Machine ID, image digest, instance/generation, lease owner, heartbeat, expiry and actual teardown evidence. A Fly API modification lease is not the application's run lease or a workload expiry timer.

The guest enforces its run expiry locally. The trusted worker fences new actions immediately on stop/lease loss, cancels inference and requests closure/destruction; an independent reaper provides eventual cleanup when the worker fails. A cloud/API outage may delay confirmed destruction: preserve `terminating`, record the error, stop further actions and use the reaper. Cancellation cannot undo a committed target write. Treat all browser events/artifacts as untrusted bounded data.

## 6. Egress and action scope: enable exploration, enforce boundaries

Two independent controls are required:

1. **Actual network destinations.** smokescreen plus nftables reject private, loopback, link-local, metadata, CGNAT, non-global and 6PN destination addresses at the actual dial. Public resources may load; public does not mean authorized for actions. Refuse Oddhound's reserved service hostnames/dedicated IPs. Public API authentication/CSRF/tenant checks still apply if an alias is reached; do not block entire shared CDN ranges or claim hostname denials cover every alias.
2. **Action authority.** The immutable run contract in MVP §17 authorizes active capability classes, actors, fixtures and verified origins. It allows registration/login and permitted state-changing traffic, including POST/PUT/PATCH/DELETE. Tool/frame checks and request enforcement block out-of-scope destinations and known forbidden operations. Do not require a predefined click path or reject every newly discovered same-origin endpoint in staging active mode. Unknown destination/actor authority is refused; unknown UI paths inside an authorized active scope are the point of exploration.

The controller cannot universally classify the business consequences of an arbitrary request. Owner-supplied staging/test-mode integrations, restricted accounts and fixture boundaries contain that uncertainty. Production active grants may be narrower. Observation-only has a different request contract; neither GET nor a model-provided label proves read safety. No broad model-created permission exception.

### Primary UI, API and resource scopes

The agent interacts with one verified UI origin. A separate first-party API origin may receive the app's normal authorized requests only after its **own** ownership verification and inclusion as an API scope, with declared methods/operations, actor/tenant/fixture binding and budget. It does not become an interactive navigation target by being an API dependency; direct security probes need their own case grant. Recheck each active origin at start/resume and freeze scope changes behind a new authorization revision. URL logs cannot auto-add origins.

Other origins are public resource dependencies only. Do not blanket-allow third-party POSTs, payment calls, identity-provider navigation or websocket writes because the frontend requests them. Public asset GET/HEAD is distinct from active API authority. A provider-hosted API the owner cannot verify, third-party interactive SSO or an unsupported socket workflow is blocked with a specific compatibility reason, not silently rerouted. Positive controls must show that same-origin registration/login and separately verified API-backed active flows work.

### Redirect and WebSocket candidate (B18/B19)

Playwright `context.route()` only sees the first redirect URL; route handlers and post-navigation listeners cannot be the sole action boundary. [T2] First evaluate fixed runner-owned CDP Fetch request/response interception through Playwright, with policy attached before pages/popups/out-of-process frames/workers execute. Validate every redirect destination before release, preserving permitted redirects and rejecting scope escapes, including 307/308 bodies. Avoid competing owners of Chromium HTTP interception: prove that the CDP policy and any remaining Playwright hooks do not override, bypass or deadlock one another. [PW5]

Register WebSocket policy before pages exist. Permit only explicitly authorized endpoints/message contracts; observation-only blocks outbound state-changing messages. An active run is not automatically denied all socket traffic, but opaque/unknown message authority cannot be assumed. Non-proxy UDP/WebTransport paths remain denied. [PW4]

R1 must cover all redirect codes/chains, method/body/header retention, new targets, frames, two actor contexts, resources and API grants with destination-side canary logs and positive controls. Candidate status is not a closed B18. If the CDP path fails, compare a proven mitmproxy gateway against the same matrix; document TLS interception, isolated trust root and upstream certificate validation. No silent fallback or homegrown TLS implementation. A Chromium policy extension is another research option, not an additional production stack. [NET1, NET2]

**Local candidate result (Oct 27):** the [owned HTTP lab](docs/ACTIVE_LAB_VERIFICATION.md) passes its single-hop 301/302/303/307/308, popup/frame, permitted-write and resource subset. Browser-level auto-attach requires flattened CDP sessions; the lab uses Node's built-in WebSocket for fixed CDP instrumentation alongside Playwright actions, because the public Playwright CDPSession does not address arbitrary child session IDs. Its loopback debug listener and read-only fixture-DB mount are lab-only instrumentation, not the production private-control design. The complete R1/R2 matrices remain pending.

**Later executable result:** [61 local checks](docs/BLOCKER_CODE_VERIFICATION.md) include the expanded network matrix and actual smokescreen/nftables. Shared workers initially escaped; worker targets lack Fetch, so they now receive a native URL gate before resume. Active worker HTTP is limited to the primary origin; cross-origin worker traffic is disabled. Main-page separately granted APIs/sockets, 25 redirect pairs, OOPIF, forms/beacons/popups and live stop passed. Cancellation is recognized only with matching native cancellation evidence. The production flattened-control transport plus proxy/firewall still needs a combined integration; neither separate local suite proves Fly source restrictions or lifecycle.

**Subsequent evidence overrides that worker verdict:** the native CDP worker gate allowed another denied canary request on regression and is **rejected as the production action boundary**. A local combined control/proxy/firewall profile passed, but does not rescue the worker failure. The [mitmproxy 12.3.1 comparison](docs/GATEWAY_BLOCKER_VERIFICATION.md) passes 53 checks, including approved cross-origin worker API/socket flows, all redirect-code pairs, independently checked API/frame authority, TLS validation and decoded-body/request/concurrency caps. A resource-only iframe initially borrowed API authority; requiring the verified UI Origin for API HTTP/socket traffic fixes the tested case. Continue hardening this gateway candidate rather than relying on the failed CDP workaround. Physical-wire quotas, preassembly WebSocket memory, the full run contract and deployed R1/R2 gates remain required before production selection/enablement. Intercepted TLS and changed Accept-Encoding must be disclosed; no original-site certificate finding may be inferred from the generated browser certificate.

**Later kernel guard proof:** [14 standalone and 68 guarded-gateway checks](docs/WIRE_LIMIT_VERIFICATION.md) demonstrate immutable 50 MiB receive/send admission quotas on marked proxy upstream flows, before established-connection acceptance, with protected counters and a bidirectional fence. Exhaustion closes the local browser and refuses a new CONNECT; six simultaneous tunnels work and excess tunnels are refused. The full active matrix and backing SQL pass with the guard enabled. These are admitted IP-byte bounds, not an exact physical-interface/provider-billing ceiling; in-flight/dropped/queued data was measured. Preserve infrastructure headroom and actual reconciliation. WS preassembly memory, helper/account/artifact coverage, guard-fault/lifecycle and deployed gates remain pending. No further blocker or production profile is cleared.

### Proxy and helper hardening

Forbid private-range/domain-IP-filter bypasses, client-selected upstream proxy headers such as `X-Upstream-Https-Proxy` and unreviewed dial/selector hooks. The proxy UID must not have unrestricted private egress. Include raw CONNECT attempts from the browser UID in SELF-21. An installed proxy is not a reviewed policy. [EGR3]

Verification, reset, preview and direct-probe helpers need the same actual-dial guarantees. Validate all A/AAAA results, reject mixed public/private answers, pin the chosen public address and preserve TLS SNI/Host/certificate checks. Do not resolve again after validation. Validate every redirect where a helper is permitted to follow one; verification follows none, sends no cookies and runs no scripts. Bound DNS/connect/response/decompression. Reset hooks are typed, scoped operations on verified origins, not arbitrary supplied fetch URLs. [SEC13]

The local test lab may permit only dedicated canary/fixture containers under an explicit isolated profile. This is not a public private-address exception. Production launches fail if the lab profile is enabled.

## 7. Alternatives and fallback

| Concern | Selected candidate | Fallback / decision rule |
|---|---|---|
| Per-run isolation | New Fly Machine per run in the separate browser app | E2B per-run environment only after the same sandbox/control/egress/lifecycle proofs. No reused-Machine public fallback merely to avoid provisioning work. [FLY7, ALT1] |
| Origin/request enforcement | Small Playwright/CDP policy layer plus network egress controls | Established mitmproxy gateway if the identical R1 matrix demonstrates better coverage; disclose changed TLS behavior. No silent weakening. [PW5, NET1] |
| Sandbox support | Non-root Chromium with sandbox enabled | Record a degraded profile separately; lack of credentials is not its release proof. Prefer a runtime that passes the required profile. |
| Provider outage | Proven Meta profile, safe checkpoint and shared budget/action ledger | Tested backup only; no blind repeated writes and no non-Meta substitution. |
| Docs/MCP outage | Evidence-backed stack-neutral report | Do not fail a finding because Context7 is unavailable. |
| Fixture/email/reset prerequisite | Authorized synthetic identity/data and supported reset | Block the affected workflow honestly; preserve independent findings. |
| Rendering/streaming | Timestamped evidence and durable SSE/polling | Clearly labeled sampled preview, not fabricated live video. |

No giant model self-hosting or general sandbox/browser framework. Keep one selected runtime/policy implementation after proof; optional experiments do not become parallel production dependencies.

## 8. Grants and sponsor attribution

**Confirmed by Drave on Oct 27:** registered, with the $150 Meta (Muse) API credit, which funds the primary profile and public use (see MVP plan §22). From the supplied guide, not an account audit: Baseten conditional $100 and possible 2M TPM; Modal conditional $100 with stated limits; Fireworks conditional $25/team. Claims and limits differ. Never total these as guaranteed available funds. Verify whether Modal's award covers the exact sandbox/endpoint/render product before allocating it. The earlier two-app ~$20 compute subtotal does not forecast per-run provisioning cost; runtime/fixture/storage/network funding is separate from Meta inference credit. [FLY5] [G1]

The Fly amount above is the two-Machine compute subtotal in the documented lowest-priced regions, **not** the total service cost. Database, fixture, storage, regional traffic and additional Machines are separate. Confirm payment access for these services; a Meta credit balance does not fund them. The public and judging inference allocations follow the transactional accounting contract in MVP §8.

Record sponsor use from actual execution: inference provider/model, sandbox provider, and any rendering provider. Show names or approved brand assets without implying endorsement, extra judging points, or a completed integration that does not exist.

The MVP succeeds with one working Meta inference profile and one safe browser environment. Additional sponsor integrations are useful only when they improve reliability, evaluation, or cost without delaying the verified-findings loop.

## 9. PostgreSQL queue deployment gate (B26)

The local 6.4.2 probe passed, but does not select or validate a hosted DB endpoint. Run explicit BullMQ migrations once in the release step, using a migration role; workers do not assume connections create the schema. Use a separate queue schema and appropriate runtime grants. BullMQ holds long-lived LISTEN connections in addition to its query pools, so choose a direct or session-mode PostgreSQL connection, not transaction-mode pooling for those listeners. Budget the aggregate connections for all queues/workers/events plus auth/app queries. On a custom pg.Pool configure its schema/search_path explicitly and close it yourself. [T14]

On the actual hosted service, prove migration reruns, notifications, sleep/reconnect, lease expiry, retry and cooperative AbortSignal cancellation. Queue cancellation is not forceful browser termination; the worker must propagate it and the browser supervisor must enforce the grace/expiry independently. Store an expiry with the browser lease so loss of DB or worker connectivity cannot create an endless run. Check the current generation/status before every action; stale workers fail closed. Queue recovery is at-least-once execution, not exactly-once side effects: an uncertain write still stops at `outcome_unknown`. SELF-06/07/23 need the application ledger and deployed supervisor, beyond the local component probe. [T14, T15]
