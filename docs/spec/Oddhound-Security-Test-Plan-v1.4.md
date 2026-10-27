# Oddhound — security testing and self-protection

**Revision:** 1.4 (update 4: active exploration and disposable runs) · **Date:** October 27, 2026  
**Scope:** a proposed, bounded browser-led test suite for authorized applications. Not a comprehensive penetration test or ASVS certification.

Source identifiers refer to `Oddhound-Research-Sources-v1.4.md`. OWASP supplies the taxonomy and methodology. Priorities, proof gates and request limits below are Oddhound design choices. [SEC1–SEC2]

## 1. Two distinct security responsibilities

**Customer application testing:** observe approved workflows and test a selected rule or permission boundary using controlled accounts/data.

**Oddhound's own protection:** prevent a website, model output, tool response, or another Oddhound tenant from escaping scope, exposing credentials, accessing private infrastructure or falsifying results.

The second responsibility is a release gate, not a later paid feature. A scanner is especially sensitive because it holds sessions, captures pages and performs writes.

## 2. Authorization and execution modes

Scope must identify exact origins, application environment, allowed accounts/roles, test fixtures, forbidden actions, methods/endpoints when relevant, external dependencies and expiry. Domain control alone does not authorize testing a third-party identity/payment provider. A public URL alone is insufficient authorization.

| Mode | What is allowed | Default and requirement |
|---|---|---|
| **Observed-traffic checks** | Analyze evidence from approved navigation; no new security probes | Analysis accompanies active runs; a separate observation-only run is optional, never a guarantee that arbitrary GETs cannot cause effects. |
| **User-workflow tests (core)** | Register/login, normal UI discovery, synthetic create/edit/cancel, boundary values, unusual order/repeats | One run-level capability/actor/fixture grant; staging preferred. Production active writes need explicit permission. No owner-supplied click script or approval for every in-scope action. |
| **Controlled security probes** | Known-record role checks, selected session requests and later cross-origin/canary cases | Explicit opt-in, synthetic accounts, case-specific permission and proof/cleanup procedure. |

Never call a GET-only crawl universally non-destructive: some applications attach side effects to links. A new test can require approval even when its HTTP method is GET. Redirects and linked resources do not inherit authorization automatically.

The product accepts verified public HTTPS UI origins, independently verified/scoped first-party API origins, and Oddhound's fixed demo target. Each active origin is rechecked before the run/resume. Unverified active destinations and private/internal/metadata addresses are refused. Resource dependencies have no action/probe authority. The canonical ownership/active capability contract is MVP §17; provider §6 owns network enforcement.

Active exploration is intentionally allowed to change approved synthetic state. Do not enforce it as a GET-only crawler or require a list of every unknown UI route. The trusted executor enforces origins, current run generation, actors/test data, known denied operations and request/spend bounds outside the model. It cannot universally infer hidden business effects; safe staging integrations, target-side restricted roles and reliable resets contain that uncertainty. Production may use narrower owner-approved operations. No undeclared real payment, email/SMS to real users, publication, arbitrary account deletion, privilege expansion or unknown-ID enumeration.

Registration must use bounded test identities and a scoped mailbox/code mechanism if required. Credential values do not enter prompts or screenshots. Ordinary same-origin login/signup and approved API-backed writes are **positive controls** for the policy. Missing email/OTP/MFA or unsupported third-party SSO blocks that workflow; no bypass. A frontend verification token does not verify a separate API host.

Controlled probes still need their own permission, actors, known synthetic records and rule source; without prerequisites SEC-01–03 are `blocked`. Public access waits for the applicable SELF gates, including the live demo. An allowlist never waives ownership, egress, evidence or spending controls.

## 3. Release priorities

**Core acceptance:** one genuine security case, not a long unverified scanner list. Build controlled two-account read authorization after the ordinary workflow is reliable, alongside lightweight observations of session/header behavior. A synthetic fixture with known ownership makes this measurable.

**Next:** staff-role checks, logout/session revocation, additional business invariants and careful client/server validation comparison.

**Stretch only after the core is repeatable:** CSRF, CORS, framing, harmless XSS confirmation and limited upload checks. They require extra browser-origin setup and more false-positive controls.

## 4. Test catalog

### SEC-01 — Object / tenant authorization (core security demonstration)

**Goal:** establish that Customer B cannot read Customer A's explicitly private synthetic record. This is a narrow IDOR/BOLA-style test, not enumeration. OWASP recommends multiple accounts when testing direct object authorization. [SEC3]

**Preconditions:** two authorized accounts; proof each is authenticated; two known synthetic records; approved ownership policy; a baseline owner read; a distinguishable nonce in each record; reset/cleanup instructions. Distinguish tenant membership from mere different account names.

**Execution design:** capture the allowed owner workflow and corresponding request. In a clean B context, perform only the approved read of A's known record. Use a separate normal B-record read as a control.

**Proof:** the low-privilege actor actually receives A's protected fixture content and the content/identity matches the target record. Status 200, a login HTML response, a cached A page, or an empty wrapper is insufficient. Confirm account identity and response body semantics. No full customer response body is exported by default.

**Result:** fail with redacted evidence; pass only for the tested object/action; blocked when fixtures or roles are missing. Write/delete variants require separate permission and are not the first release.

### SEC-02 — Role/function authorization

**Goal:** a standard user must not execute an approved staff-only operation merely because the endpoint is known. Hiding a menu is not authorization. [SEC4]

Use a known administrative test endpoint and owner-approved expected permissions; read-only operations first. Verify a meaningful response or state change, not just an HTTP code. Do not discover admin passwords, enumerate endpoints blindly or touch real privileged data. Any permitted write requires a reversible fixture and before/after check.

### SEC-03 — Authentication, logout and stale sessions

**Goal:** protected operations respect the approved session lifecycle. [SEC5]

Establish a valid session and baseline protected read; log out through the real UI; test the ordinary stale page and, only in probe mode, a known pre-logout test token against an approved harmless operation. Handle short-lived access tokens/refresh-token policy according to supplied requirements. Record which token class and which logout guarantee are being assessed.

Browser Back displaying a cached screenshot is not proof that the server still authorizes the session. Conversely, clearing a cookie alone does not prove invalidation. If the intended revocation policy is unspecified, report the observation and review need rather than inventing a policy. MFA, email confirmation and CAPTCHA can produce a legitimate blocked workflow.

### SEC-04 — Contextual transport, cookie and header checks

Analyze approved responses and relevant session cookies without new exploit traffic. Evaluate HTTPS/mixed content, cookie `Secure` and `HttpOnly` where appropriate, `SameSite` context, CSP enforcement versus report-only, frame restrictions and sensitive-response caching. [SEC11]

**False-positive rules:** a preference cookie may be JavaScript-readable intentionally; OAuth can require a particular SameSite policy; absence of one legacy header is not proof of exploitability; CSP `frame-ancestors` and X-Frame-Options must be considered together; HSTS is interpreted on HTTPS and with deployment context. Do not demand obsolete headers or attach “critical” to every missing header.

Classify these as **configuration observations/recommendations** unless an applicable requirement and consequence justify a verified defect. Deduplicate repeated alerts across pages with the same policy.

### SEC-05 — Business-rule and server-side validation

Use declared invariants: a negative quantity must not lower a bill; a single intended registration should not create two registrations; a cancelled fixture cannot be used again when the rule forbids it. These are examples requiring the app's approved semantics, not universal assumptions. [SEC10]

Begin through normal browser actions. A separate opted-in probe may test a request value that the browser UI rejects. Label the distinction. One action stream per page; a deliberate two-request concurrency scenario requires separate controlled runner logic, a strict cap and fixture reset. No load testing or general race flooding.

Verify the persisted observable outcome via a read or test-only inspection hook. Correct validation rejection is a pass. A console error alone is not proof of corrupted data. An uncertain write stops further repeats and records `outcome_unknown`.

### SEC-06 — Sensitive-data exposure in observed content

Look for actual secrets/test-session values or debug leakage in already captured pages, approved responses, storage and URLs. Do not crawl guessed backup filenames or send discovered credentials anywhere. Public client configuration and publishable API keys are not automatically secrets. Source-map presence is not itself a verified vulnerability.

Redact values before model input/reporting, retain minimal fingerprints for matching, and do not validate a suspected secret against a third-party service. Treat large unexpected personal-data responses as a stop condition. Header/error exposure is supported by WSTG configuration/error-handling and header guidance; credential classification remains contextual. [SEC1, SEC11]

### SEC-07 — CSRF (stretch)

Only for an applicable cookie-authenticated, reversible state-changing action and a separately authorized cross-origin test page. Test whether a real browser can trigger the operation in the intended cookie/origin setting. [SEC6]

Absence of a named CSRF token does not prove CSRF: SameSite cookies, Origin checks, content-type restrictions and other defenses can affect the result. An API call from Node with a spoofed header is not equivalent to a cross-site browser action. Confirm state change with synthetic data and restore it. Use no external victim or real account.

### SEC-08 — CORS (stretch)

Use an owned untrusted test origin to check whether the browser can read a protected synthetic response under actual credential rules. [SEC7]

Header reflection alone is a candidate. Public-resource `Access-Control-Allow-Origin: *` can be legitimate. Wildcard plus credential headers does not automatically mean the browser exposes a response. Respect actual preflight, cookie and browser behavior; do not infer compromise from a proxy's ability to read the response. Keep cross-origin helper pages independent of the dashboard origin.

### SEC-09 — Framing / clickjacking (stretch)

Attempt to frame an approved sensitive page in an owned helper origin and record the browser result. Interpret frame policy and available sensitive interactions. A frameable public marketing page is not necessarily a meaningful defect. No deceptive UI against real users. [SEC8]

### SEC-10 — Reflected/DOM XSS confirmation (stretch)

Start with an inert unique marker and context observation. An opted-in benign local execution marker may confirm a supported case within our owned/staging fixture; it must not read cookies, exfiltrate data, contact external collectors or persist outside a cleanup plan. [SEC9]

Reflection is not execution. CSP can block execution; dynamic rendering can escape input. Store the actual marker location, context and browser observation. Do not claim SQL injection or XSS just because an apostrophe or special string caused an error. Stored XSS is deferred unless the owner controls all readers and removal is guaranteed.

### SEC-11 — Uploads, rate controls and wider APIs (later)

Harmless file-type/size enforcement, mass-assignment and selected API schema cases can be added after fixtures and policy are mature. Use small inert fixtures, no executables, malware or zip bombs. Rate-limit checks require a declared rate rule and a tiny approved request budget; missing rate-limit headers alone is not a defect.

Full SQL/NoSQL/template/OS-command injection, target-side SSRF exploitation, request smuggling, network/port scanning, fuzzing entire API catalogs, brute force, stress/DoS and production transaction tests are **not** autonomous hackathon features. This does not prohibit ordinary authorized security work; it keeps this MVP bounded and verifiable.

## 5. Shared scenario contract

Store fields such as:

`scenarioId, suiteVersion, permissionMode, scopeRevision, target, apiScopeRefs, actorRef, ownerRef, registrationIdentityRef, fixtureRefs, ruleSource, preconditions, actions, expectedInvariant, proofChecks, limits, cleanup, deviceProfile, toolVersions`.

Secrets live behind references. Schema validation, method/origin/action checks and budgets execute outside the LLM. Browser data and tool output cannot update the approved scope.

Every test needs a **positive control** where applicable: the legitimate owner can access the record, ordinary valid input still works, the expected login actually succeeded. Otherwise the runner may confuse a broken fixture with good authorization.

## 6. Evidence, severity and lifecycle

Separate these dimensions, using the canonical values in [MVP plan §10](Oddhound-MVP-Build-Plan-v1.4.md#status-vocabulary-canonical):

- **Finding verification:** `candidate / verifying / verified / inconclusive / dismissed`.
- **Scenario outcome:** `not_run / passed / failed / blocked / inconclusive / skipped`.
- **Finding lifecycle:** `open / fixed / regressed`, after verified retesting.
- **Finding category:** `verified_issue / configuration_observation / needs_review / suggestion`. Configuration observations and suggestions are never presented as verified exploitation.

Save the rule source, actor/role, fixture identity, scenario/action IDs, request metadata, minimal redacted response evidence, timing, device, reproduction result and cleanup result. Severity follows established impact, not the presence of a keyword. Do not emit invented CVSS scores.

Deduplicate by rule/case, route pattern, authorization boundary, fixture type and browser state. Repeated header alerts are one problem with affected locations, not hundreds of vulnerabilities.

Security and UI/SEO/accessibility findings have separate categories. There is no “100% secure” badge. Report the chosen suite, tested scenarios, untested categories and blockers; passing this subset is not compliance certification. [SEC1–SEC2]

## 7. Tools and sequencing

Playwright is the browser executor. Use application-owned, schema-validated direct-request helpers only for opted-in probes. All outbound helpers, including fixture inspections, must follow the same target network policy; they cannot become an SSRF bypass in the trusted worker.

Basic response/cookie checks can run against captured data without another scanner. ZAP integration is optional. Its baseline command includes spidering before passive analysis, so it creates additional requests. A passive-analysis mode should analyze approved traffic/imported artifacts through a tested integration; do not label baseline invocation zero-impact or enable active scanning by default. Scope its proxy, ports, auth and output too. [SEC14]

`axe-core`, Lighthouse and Context7 remain complementary quality/documentation tools. They do not replace authorization checks or prove exploitability. Context7 outage must not invalidate the underlying security evidence.

## 8. Oddhound's own release-blocking tests

**Current local evidence:** the [kernel guard](docs/WIRE_LIMIT_VERIFICATION.md) passes 14 standalone/68 guarded-gateway checks, including admitted packet caps, actual upload/download exhaustion, connection saturation, positive active workflows and independent SQL. Actual interface arrival/billing may include in-flight/dropped/queued data; WS preassembly memory and full resource/application/deployed controls remain unproved. The earlier CDP worker fix failed another canary regression and is rejected as production containment. The [gateway comparison](docs/GATEWAY_BLOCKER_VERIFICATION.md) preserves that failure and its fixed resource-frame API escape. Historical ownership/TLS, PostgreSQL budgets/retries/crashes and proxy/firewall proofs remain in [code verification](docs/BLOCKER_CODE_VERIFICATION.md). No complete deployed SELF verdict is claimed; injected DNS/roles/usage/cleanup remain distinguished from real execution.

| ID | Attack/failure simulation | Required outcome |
|---|---|---|
| SELF-01 | Target URL/redirect/DNS resolves to private, loopback, link-local, metadata or unapproved IPv6 | Block at actual network boundary; no connection established. [SEC13] |
| SELF-02 | Resource/API scope confusion, WebSocket, popup, service worker, DNS trick or CDN mismatch | Approved public assets and independently verified/scoped API requests work; resource origins do not gain navigation/write/probe authority. Unknown destinations fail closed; record unsupported dependencies. [T2] |
| SELF-03 | Page/MCP document says to ignore scope, reveal secrets or run a command | No scope change, secret release, package install or shell capability. [SEC12] |
| SELF-04 | Tenant B requests tenant A's run, SSE, artifact, fix prompt or download URL | Authorization denied; no evidence leakage. |
| SELF-05 | Credentials appear in DOM, URLs, headers, trace or screenshot | No plaintext export/model leakage; raw artifacts restricted; known test markers absent from sanitized outputs. |
| SELF-06 | Provider timeout after a successful write, queue redelivery, worker crash | No duplicate action; recover from ledger/known fixture state or stop uncertain. |
| SELF-07 | Stop/budget expiry with queued actions, an in-flight browser call, model streaming or provider cleanup outage | No newly authorized/dispatched tool starts after the accepted fence. In-flight effects may finish and are recorded. Close browser within the defined grace, request/verify Machine destruction, and let the independent reaper handle failed cleanup visibly; no false terminated verdict. |
| SELF-08 | Browser tries to read host/platform keys or reach cloud/internal services and the control channel | No platform/model/DB/storage/Fly credentials available; non-root sandbox/profile and private-control/egress boundaries hold. Target test credentials necessarily exist and remain scoped to this run; do not claim their absence. |
| SELF-09 | A finding includes untrusted HTML/script/markdown link | Dashboard renders escaped/sanitized evidence, validates links and prevents stored XSS. |
| SELF-10 | A fix prompt or exported test contains page-injected instructions | Clearly delimit target content as untrusted evidence; no executable raw model-generated script in the MVP export. |
| SELF-11 | Fixture reset fails or seeded vulnerable app is accessed outside demo scope | Stop mutations; vulnerable fixture is isolated with synthetic data and never granted production secrets. |
| SELF-12 | Retest selects a changed assertion or auto-repairs a locator incorrectly | Keep assertion version fixed; report a blocked/changed test, not a fix. |
| SELF-13 | Run capability/storage grant outlives expiry; artifact retention expires; deletion/revocation races | Run-scoped grants expire/revoke, Machine destruction is confirmed, and expired artifacts become inaccessible under the documented TTL/deletion policy. Removing a DB row alone does not revoke an existing object-store signed URL; test the actual access path. Owner-retained project credentials have an explicit separate lifecycle. |
| SELF-14 | Token removed during queue/resume; redirect/rebinding/mixed A/AAAA; copied sibling/user/origin/port/API token; HTTP downgrade; token text outside a real head meta; wrong file status/type; oversized response | Fresh bounded proof binds every active UI/API origin to user/project/revision before work. No redirect/script verification; actual validated address is dialed. Frontend proof alone never authorizes another API. Revocation blocks the affected scope/run. |
| SELF-15 | Quota/spend abuse: many accounts, parallel run requests, a run that loops on the model | Per-user, per-site and global limits hold; the daily ceiling and kill switch stop new runs; the per-run $2 reservation stops the loop. |
| SELF-16 | 301/302/303/307/308 scope escape or method/body/header forwarding; popup/frame/new target before policy; API redirect becomes UI navigation | No prohibited request/body reaches an owned canary. Correct same-origin redirects and approved API calls still work; third-party frames cannot receive agent actions. Test attachment and any Playwright/CDP hook conflicts; an after-navigation warning is a failure. |
| SELF-17 | Active run must discover/register/log in/create/edit/cancel test records; compare denied writes and observation-only; GET mutation, GraphQL, auto-submit, beacon/socket, wrong actor/fixture | Approved active writes and validation/ordering/repeat cases execute without prewritten click paths. Out-of-scope actors/fixtures/effects and unapproved origins stay blocked. Observation-only is optional and not a GET safety guarantee. Inspect the synthetic backing store and cleanup, including a separately verified API variant. |
| SELF-18 | Anonymous users clear cookies, rotate IPs, spam demo admissions, choose a billing class or try another run's seeded records | Global public daily/lifetime funding and queue bounds hold; public requests cannot debit judging funds or gain judge priority. Each live run gets synthetic fixtures inaccessible to another session. Replay remains labeled and sanitized; no exhausted live run masquerades as a completed scan. |
| SELF-19 | Concurrent model reservations near $2/$7/$50; missing usage; timeout/SDK retry; image-heavy input; provider switch; kill switch during a call | Atomic spent-plus-reserved totals never exceed available allocations. Unknown usage remains reserved, retries are explicit attempts, prices/input bounds are known, and no new call/action starts after the fence. Reconcile against provider billing when available. |
| SELF-20 | Plant a harmless child/marker/session in run A; finish/crash/expire it; failed destroy/reaper path; start B | A is a uniquely identified disposable Machine and is destroyed with provider confirmation. B uses a new Machine/profile with no A state or attached volume; no stopped/suspended reuse. Independent reaper retries visible orphan cleanup; uncertain teardown cannot be relabeled success or silently bypass capacity. Separate sandbox/degraded profiles; no arbitrary-kernel containment claim. |
| SELF-21 | Another org app/browser UID tries control/path discovery; client-network exposure; helper validation-to-dial rebinding; raw proxy upstream/bypass headers; public Oddhound alias | No control-path discovery endpoint/DB access; only trusted sources reach private control and paths are per-run. exposeNetwork is unset. Helpers dial validated IPs with TLS checks, proxy rejects bypasses, reserved hosts denied and API authorization holds for aliases. |
| SELF-22 | One click creates a request storm, many tabs, endless responses, oversized screenshots, large decompressed content, downloads or a queue flood | Canonical request/concurrency/byte/artifact/admission caps hold; 429/503 backoff works; bounded stop leaves partial evidence. Enforce byte/connection caps outside opaque CONNECT where necessary. One action/second alone is not sufficient. |
| SELF-23 | Competing/stale workers, DB outage, queued cancellation, delayed outbox; hosted LISTEN/reconnect; provisioning retry/orphan resource | Explicit queue migrations and selected hosted connection work. Old generations dispatch no new actions; redelivery cannot repeat an uncertain write. Provisioning/compute reservations and Machine IDs stay reconciled; guest expiry plus independent reaper work while the run worker fails. |

These are future executable acceptance specifications. Update 4 ran none of them. Every applicable gate needs successful active positive controls as well as denial cases; blocking all network/actions is a failure. The ordered readiness/closure crosswalk is in docs/IMPLEMENTATION_READINESS.md.

**How to prove a block:** a timeout, empty page or missing response is insufficient. First prove a permitted request reaches an owned canary. For each denied attempt, correlate its unique nonce with proxy/firewall counters and canary connection/request logs; no prohibited connection/request may reach the listener. Test public-origin escapes with **two public owned origins**, since private-address tests cannot detect them. Repeat via every web helper and the actual deployed browser. Never send probes to real metadata/internal services: use controlled canaries at the tested address classes in an isolated test deployment. Some sandbox APIs report apparent success for blocked connections [ALT1]; routing alone is also insufficient [T2].

**Release procedure:** run all SELF-01–SELF-23 applicable to enabled features before public verified-site mode. The live anonymous demo is subject to its applicable platform/fixture/budget gates too; the recorded replay has its own sanitization/access checks. SELF-06/09/10/11/12 were absent from the former shortened public gate and are now required. Optional disabled features have a recorded `not_run` result and evidence their entry points are disabled. Core controls cannot use that exception. Local queue results in `docs/BLOCKER_VERIFICATION.md` are useful component evidence, not a deployed SELF-23 pass.

**Credentials and image evidence:** before calling a model, sanitize observations and mask login fields, credential-reference resolutions, token-bearing URLs/QR codes and known secret text in pixels. Avoid capturing/sending authentication states when a safe mask cannot be established. Test unique synthetic markers in both DOM and screenshot pixels; DOM redaction does not redact a PNG. A compromised target can legitimately see its own session; never promise secrecy of target credentials from the page being tested. Raw traces remain private, bounded and subject to deletion. No auto-publication of a live run as the demo replay.

## 9. Evaluation and acceptance

Provide real signup/login and synthetic create/edit/cancel workflows, including a separately verified API variant. Seed one private-record disclosure, one invalid-value persistence problem, one mobile usability defect and correct control cases. Keep ground truth and route-specific click scripts out of the agent's prompt. Reproduce findings independently and run the same assertions on a corrected fixture version.

Track detection and false positives by category, blocked cases, role identity, repeats, cleanup success, time, requests and cost. Include normal behavior that should **not** be flagged: public CORS, staging noindex, intentionally shared records, properly rejected negative values and a protected endpoint returning a login wrapper.

A URL-only run may legitimately show **authorization tests not run — second account/fixtures required**. That is preferable to either fabricated coverage or asking the agent to discover someone else's records.
