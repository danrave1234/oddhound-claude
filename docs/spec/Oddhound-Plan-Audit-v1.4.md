# Oddhound — plan audit and blocker register

**Revision:** 1.4 (update 4: active-testing alignment) · **Audit date:** October 27, 2026  
**Audited in update 3:** current repository/plans, official provider/Playwright/BullMQ/Fly sources, package availability, image manifests, local tooling, a real local queue probe, and connected GitHub metadata for candidate sites. Earlier guide claims are retained from G1; its uploaded original is not present here for a fresh audit.  
**Not audited in update 4:** the full Oddhound application, deployed browser, authenticated model calls, provider billing, real-site scans, or rendered demo. The later authorized local fixture has its own evidence record below. No existing credential values were read or printed.

## Verdict

**Active exploratory testing is the product.** Registration/login, approved synthetic writes and unexpected interactions are positive requirements. Observation-only is optional, and production active testing requires owner write permission. Broad staging capability grants must not become a list of known click paths.

**Update 4 is documentation only.** The selected baseline is now a fresh Fly Machine per run, separate browser app, private control without a path-discovery endpoint, actual-dial egress plus a tested action/request policy, and independently verified first-party API scope. The old reused-Machine/Chromium-restart and fixed nine-day assumptions are superseded. E2B and mitmproxy are contingency candidates, not working integrations.

The [implementation-readiness document](docs/IMPLEMENTATION_READINESS.md) owns the model-neutral R0–R7 proof-gate crosswalk. Drave subsequently authorized the barebones local fixture and verification; that slice is now implemented. Full product implementation/public launch is not cleared by this limited authorization or its local results.

**Prior actual proof remains unchanged:** seven local queue checks passed on Node 26.12.1 / BullMQ 6.4.2 / PostgreSQL 17.11, plus the small probe audit and metadata checks. No application, provider, Fly or deployed SELF proof is added in this update. [Historical verification record](docs/BLOCKER_VERIFICATION.md).

**Later local proof:** [17 scripted browser checks passed](docs/ACTIVE_LAB_VERIFICATION.md): real fixture accounts/writes, non-root namespace/Seccomp-BPF sandbox, immutable defect/fix assertion, and the tested redirect/popup/frame scope denials with canary positive controls. This is partial component evidence for B04/B06/B10/B18/B19, not closure of any complete runtime blocker or SELF gate. No Meta calls or Fly deployment occurred.

**Historical baseline:** [61 code checks passed](docs/BLOCKER_CODE_VERIFICATION.md), including ownership/helper TLS, PostgreSQL races/redelivery/SIGKILL and smokescreen+nftables+sandbox. Unfunded admission was fixed. The shared-worker workaround initially passed but failed the later regression below; that fix is no longer claimed reliable. Meta/Fly credentials remain unconfigured; no full deployed SELF or public launch is cleared.

**Historical combined-control run:** 14 further checks brought the earlier saved count to 75. These records remain unchanged for provenance. Five initial fix groups were reported; the worker verdict was subsequently withdrawn. The current gateway results and failed regression are recorded below.

**Latest runtime disposition:** the [gateway comparison](docs/GATEWAY_BLOCKER_VERIFICATION.md) now passes **53 local checks**, and relevant workflow/egress/combined regressions pass 38. The CDP network regression **fails after two passes**: a real shared-worker request arrived despite the native gate. Its earlier fix/containment claim is withdrawn; reject that candidate as the production boundary. A resource-frame API escape in the gateway was reproduced and fixed, with approved worker APIs/sockets preserved. The cumulative 128 saved passing records are historical plus candidate results, not an all-green current system. **Closed IDs remain B13/B25 only**; physical-wire/WS buffering and deployed/model/application gates remain.

**Later traffic-control result:** the [kernel guard](docs/WIRE_LIMIT_VERIFICATION.md) passes **14 standalone and 68 guarded-gateway checks**, including packet admission quotas, upload/download exhaustion, six accepted/six refused concurrent tunnels, full active controls, independent SQL and browser closure. Queued/in-flight/dropped bytes are measured, so no exact NIC-arrival/billing guarantee is claimed. **B24 remains partial; closed IDs remain B13/B25 (2/27).** WS preassembly, remaining resource/helper/account/admission/guard-fault checks and actual deployed/model/application gates remain.

## Blocker status

**Status key:**
- ✅ **Closed:** confirmed fact or decision; no further proof needed.
- 🔧 **Design fixed:** the documents now specify the fix; the stated proof still has to come from running code.
- ⏳ **Open:** waiting on someone outside the project.

These register labels are audit dispositions, not additional application status values. A component pass does not close a product/runtime blocker.

| ID | Status | Gap or risk | Fix in the documents | Required proof | Fallback |
|---|---|---|---|---|---|
| B01 | 🔧 | Model access and credits | ✅ Registration and $150 Meta credit confirmed by Drave (Oct 27). Direct Meta is primary; Baseten is the backup once `/v1/models` lists the event alias [P1, P18]. | Authenticated text/tool/image/usage smoke suite on Direct Meta; same for the backup when enabled | Run on Direct Meta alone; never fake sponsor use |
| B02 | 🔧 | Provider differences: Meta accepts only `tool_choice: "auto"`, takes images only in `user` messages and rejects `stop`/`logprobs`; Baseten Muse Spark Open has no JSON mode; primary and backup are different models [P1, P15, P16, P19] | Adapter rules in provider plan §3 | The same scenario passes under both enabled profiles; differences recorded in `EVALUATION.md` | One validated provider only |
| B03 | 🔧 | Private-address access and action-scope escape while testing real sites | Actual-dial smokescreen/firewall checks plus separate active UI/API authority; permits approved writes, not arbitrary destinations | SELF-01/02/16/17 on deployed browser with allowed controls and owned canary logs | Keep that capability closed; an allowlist cannot waive the boundary |
| B04 | 🔧 | Hostile page compromises browser/runtime | Fresh Machine per run in a separate app without platform credentials; non-root sandboxed Chromium; protected proxy/firewall and reaper | Actual UID sandbox verdict and SELF-08/20/21; image/runtime/platform-credential checks | Evaluate E2B if Fly fails required profile; degraded no-sandbox is not an automatic public clearance |
| B05 | 🔧 | Trusted verification/reset/probe helpers bypass browser controls | Actual-dial IP pinning, TLS checks, bounded typed operations and each active API origin independently verified | SELF-01/14/21 with validation-to-dial rebinding and redirect cases on every helper | Disable unsafe helper/workflow, not a private-IP exception |
| B06 | 🔧 | A URL and credentials don't establish ownership, rules or backend outcomes | Ownership verification, role/fixture contract, positive controls, rule provenance | Two-account case on the demo target; an independently reproduced rule violation | Suites without prerequisites show `blocked` |
| B07 | 🔧 | Failover, retries or a crash repeat a real write | Durable action intent/result, generation fence and no blind mutation retries; approved active writes remain allowed | Fault injection after target save but before acknowledgement, with persisted-state controls | Stop at `outcome_unknown`; never count a repeated uncertain Submit as recovery |
| B08 | 🔧 | Evidence leaks credentials or runs malicious markup in Oddhound | Private raw artifacts, redacted views, output escaping, tenant-bound access | Cross-tenant tests; secret markers absent from exports | Disable raw downloads |
| B09 | 🔧 | Browser control capability leaks or another org app reaches it | Controller pre-generates per-run path; Fly supplies private Machine address; no discovery endpoint/browser DB; source-restricted 6PN | SELF-21 from unauthorized app/browser UID, path absence in logs/UI, old path rejected after destroy | Keep remote browser unavailable until control proof passes |
| B10 | 🔧 | No demonstrated failure → fix → retest loop | Fixed scenario/assertion versions; no auto-healing | Original assertion fails before and passes after the fix; a valid case still works | Narrow to one workflow |
| B11 | ⏳ | Final rubric missing (`[table]` in the guide); start-time ambiguity | Organizer questions in the README | Answers from the organizers | Don't invent criteria |
| B12 | 🔧 | The film could overstate the product | Claims ledger, genuine active-workflow footage and plain-editor fallback assembled from real clips | Real verified-site footage, claims/redaction and encoded render/link checks at R7 | Plain-editor cut; never generated findings/activity |
| B13 | ✅ | Registration | **Closed:** Drave confirmed registration and the $150 Meta credit on Oct 27 | — | — |
| B14 | 🔧 | Critical Next.js/React RCE advisories [T7] | Floors `next` ≥ 16.4.3, `react` ≥ 19.3.1; `pnpm audit` in CI | Lockfile shows the floors; audit clean at submission | Disable the affected features |
| B15 | 🔧 | Product works only on seeded scripts/demo or cannot register/login/write on normal apps | Active autonomous discovery with run-level capability grants; separately verified API scope; two selected real sites | R4/R6: unseen signup/login/create/edit/cancel cases without click scripts, persisted evidence, controls; two real verified runs; signed-out entries | Narrow supported integrations honestly; do not replace active testing with observation-only |
| B16 | 🔧 | Ownership bypass across users/origins/API scope, redirects, stale tokens or DNS | Exact-origin/user/project/revision proofs rechecked after queue/resume; each active API separately verified; pinned dial | SELF-14 with wrong token, removed proof, malformed/meta/file, redirect and mixed-address cases | Refuse affected scope/run; no frontend-only proof for another API |
| B17 | 🔧 | Public use exhausts credit before judging | Per-user quota, daily/lifetime public ceilings and kill switch; $15 reserve accessible only through authenticated admin/judge grants (MVP §8, §22) | SELF-15/18/19; reconcile against Meta billing | Ordinary public demo requests cannot spend the reserve; show replay when unfunded |
| B18 | 🔧 | Redirect/new-target/frame/worker escape; route-only checks skip later hops | Reject failed CDP/native worker gate; gateway candidate has 53 local checks and fixes resource-frame API authority borrowing; complete boundary/deployed proof remains | SELF-16 on all redirect codes/chains/307-308 bodies/new targets, with permitted redirects/API flows and destination logs | Continue tested mitmproxy hardening; disclose TLS changes and do not enable before remaining gates |
| B19 | 🔧 | Method-only/read-only restrictions defeat active testing or misclassify business side effects | MVP §17 capability/account/fixture contract: real register/login/writes and novel UI paths allowed, observation-only optional; production explicit writes; staging containment | SELF-17 + R4 allowed signup/login/create/edit/cancel/API-backed flows, denied effects/actors, backing-store controls; no ground-truth click scripts | Block only unsupported/out-of-scope workflow; never claim universal side-effect classification |
| B20 | 🔧 | Anonymous demos have no GitHub quota and can consume the supposedly protected judging reserve or share fixtures | MVP §8 separates public/demo/judge ledger classes, anonymous limits, bounded queue and fixture/session binding | SELF-18 with cookie/IP rotation and forged billing/priority inputs | Show funded availability and labeled replay when live funding is unavailable |
| B21 | 🔧 | $2/$7 limits can race; history/images, unknown usage and SDK retries can exceed expected-cost reservations | MVP §8 specifies atomic integer ledger, conservative call bounds, lifetime public ceiling, held unknown reservations and explicit retries | SELF-19 under concurrent admission/calls and unknown usage; later billing reconciliation | Refuse unpriceable calls; preserve partial results and reservation |
| B22 | 🔧 | Process/profile persistence leaks across runs; restart mistaken for tenant isolation | Fresh pinned Fly Machine per run, no persistent volume/profile/snapshot reuse, destroy confirmation and independent orphan reaper | SELF-20 with marker/child/session, worker crash, delete failure and distinct clean next Machine; source/image/sandbox metadata | Do not reuse suspect/undestroyed runtime or silently bypass its capacity slot |
| B23 | 🔧 | DB/bootstrap path disclosure, worker-network tunnel, unsafe proxy settings, reserved aliases | No browser DB/discovery endpoint; per-run path from controller, source restrictions, no exposeNetwork; pinned helpers/proxy deny-bypasses and API authorization | SELF-21 including raw CONNECT, another org app, helper rebinding, config/log leakage and public aliases | Disable unsafe helper/runtime; no platform credentials added to guest |
| B24 | 🔧 | A click, registration loop, queue flood or provisioning retry amplifies traffic/compute/cost | Canonical action/request/byte/artifact/admission/identity caps plus compute reservation, bounded create retries and orphan slots | SELF-22/23 plus allowed active workflow within limits; measure actual runtime cost | Stop with partial evidence; no hidden provisioning or account-creation loop |
| B25 | ✅ | Closed documentation inconsistency: shortened launch gate omitted SELF-06/09/10/11/12 and live demo | All enabled applicable SELF-01–23 remain required; update 4 adds positive active controls and R0–R7 crosswalk | Documentation consistency only; every deployed SELF verdict still pending | Disabled optional entry points must be demonstrated; no P0 waiver |
| B26 | 🔧 | Hosted queue/runtime fencing differs from local backend viability | Explicit migrations, direct/session LISTEN, pool/role sizing, durable outbox and action/generation/compute reservations | Local seven-check probe passed; R3/SELF-06/07/23 on actual hosted DB + application runtime still required | pg-boss after its own same-host probe only; no Redis |
| B27 | 🔧 / ⏳ | Node/Fly/DB/OAuth/model/access/funding/Git prerequisites not established for app | Pinned Node 26 queue probe and authorized local browser lab work; wider configured access is still needed | R2/R3 app runtime/access/hosted proofs and Git history within requested scope; no credentials in chat | Local component work only until wider scope/access is established; never claim account/deployment readiness from docs |

## Do these next — local slice started, then remaining proof gates

1. **Local slice:** retain the working fixture and 17-check evidence; expand the R1 matrix only within authorized scope. No development-model role or cross-environment coordination is required.
2. **Before wider implementation:** configure credentials by local references, access/funding and Git within the scope Drave requests. Organizer/rubric/reuse issues remain B11 and cannot be fixed by coding.
3. **Remaining R1/R2:** API/socket/worker/redirect-chain/helper cases and the deployed disposable runtime, with actual-dial private-address denial and canary positive controls. No full dashboard as a substitute for those proofs.
4. **Then:** R3 actual Meta/hosted queue/accounting/action fences, R4 genuine discovery and defect, R5 evidence + unchanged retest, R6 two real sites + deployed public gates, R7 submission artifacts.

The authoritative proof-to-blocker map and closure-record format are in [implementation readiness](docs/IMPLEMENTATION_READINESS.md#4-proof-gates-and-blocker-closure). A specification fix is not a runtime pass. Local component results retain their limited scope; no new test has been executed in update 4.

## Remaining risks

| ID | Priority | Observation | Response |
|---|---|---|---|
| A01 | ✅ | Playwright version settled: **1.64.1** stable [T3] | Pin npm and image to 1.64.1. |
| A02 | P1 | Docs/MCP outages could block the result | Context7 degrades gracefully to a stack-neutral brief. |
| A03 | P1 | "Passive" could be mistaken for zero traffic | Analyze observed traffic; ZAP baseline spiders, so it needs permission. [SEC14] |
| A04 | P1 | Service workers and redirects hide requests from `page.route()` [T2] | `serviceWorkers: 'block'`; network boundary at the proxy, not routing. |
| A05 | P1 | Fireworks privacy differs by endpoint [P7] | Chat Completions only (zero retention by default). |
| A06 | P1 | OAuth redirects, third-party identity providers and MFA on real sites | Third-party origins are never acted on; MFA/CAPTCHA → `waiting_for_input`/`blocked`; document supported login flows. |
| A07 | P1 | Fixture writes interfere between roles, viewports and reruns | Namespaced fixtures, reset contract, run lease. |
| A08 | P1 | Mobile emulation could be oversold | Labelled emulation; physical devices out of scope. |
| A09 | P1 | Calendar targets mistaken for engineering proof | Drave removed fixed nine-day task gating; use R0–R7, keeping the event cutoff separate. No date waives safety or truthful scope. |
| A10 | P1 | Claims file could contain invented metrics | Every claim bound to evidence. |
| A11 | P1 | Media and screenshot disk use | Per-run artifact limits; expiry job. |
| A12 | ✅ | `hyperframes doctor` exits 0 whenever it runs [H3] | Gate on `.ok`. |
| A13 | P1 | Pre-1.0 and new majors (`hyperframes` 0.8, BullMQ 6) | Exact pins; no mid-event upgrades except security fixes. |
| A14 | P1 | Fix prompts carrying page-injected instructions to the user's coding agent | Delimit untrusted evidence; trusted regression templates. [SEC12] |
| A15 | P1 | Inference TPM mistaken for scan capacity | Separate provider quota from target politeness limits. |
| A16 | P1 | Unclear origin of earlier prototypes/logos | Disclose; submit only new work. [G1] |
| A17 | ✅ | HyperFrames Studio has no Windows build [H6] | CLI-only on native Windows. |
| A18 | P2 | Custom domain not purchased | Fly URL is a valid fallback. |
| A19 | P1 | shadcn defaults to Lucide icons [T8] | Rewrite to the local `Icon` layer or use Radix directly; lint fails on `lucide-react`. |
| A20 | P1 | Context7 free tier is 1,000 calls/month [T11] | Configure a key before its explicit integration test; cache results and fall back to stack-neutral briefs when unavailable. |
| A21 | P1 | HyperFrames Windows issues [H9] | Native PowerShell render; `check` without snapshots if blocked; fallback cut. |
| A22 | ✅ local / P1 deployed | BullMQ's PostgreSQL backend is new [T9] | Local seven-check probe passed on 6.4.2; hosted DB/worker integration remains B26. Fallback pg-boss only; no Redis. |
| A23 | P2 | Muse Wonder untested [P22] | Optional comparison only after the primary workflow/evidence gates pass. |
| A24 | P1 | Breadth of scope can distract from a working vertical slice | Use R0–R7 and actual allowed/denied controls; a plausible generated implementation is not proof of behavior. |
| A25 | P1 | User namespaces on Fly remain unproved [FLY4] | R2 tests actual browser UID launch/verdict. Degraded profile is separately recorded; prefer a runtime that passes required sandbox/egress/lifecycle gates. |
| A26 | P1 | Active testing can affect real business state | Active is core; production writes need explicit capability/data permission, restricted accounts and safe integration settings. Observation-only optional; do not promise browser-level knowledge of all side effects. |
| A27 | P2 | A single browser Machine makes judges queue behind public users | Bounded visible queue; only authenticated judge/admin grants gain priority. Reserve funds do not preempt an active run. Add capacity only after measuring/funding it. |
| A28 | P1 | The ~$20 hosting claim omits PostgreSQL, fixture hosting, storage, traffic and regional pricing [FLY5] | Record a complete funded infrastructure estimate. Two lowest-region compute presets alone total $20.09. Meta credits cover inference only. |
| A29 | P1 | Anonymous target users cannot be reliably identified by IP/cookie | Global spend and admission bounds are the authority; session/IP throttles only reduce friction. Judge funding cannot be selected through public inputs. |
| A30 | P1 | Artifact deletion cannot revoke an already issued object-store signed URL automatically | Use short TTLs, an authenticated download gateway where immediate revocation matters, and test access after expiry/deletion; do not claim revocation merely because a DB row was removed. |

## Better alternatives considered

| Area | Earlier choice | Chosen now | Why |
|---|---|---|---|
| Product scope | Invite-only; public demo on owned fixtures | **Verified-site mode for any GitHub user**, plus demo target and replay | Genuine product; ownership verification is the authorization. [VER1] |
| Browser isolation | Reused Fly Machine + process cleanup | **Fresh Fly Machine per run**, separate browser app, smokescreen/nftables | Simpler cross-run isolation; still requires sandbox/control/egress/destruction/reaper proof. Target sessions remain sensitive. [FLY7] |
| Host | Generic container hosting | **Fly.io first**, with E2B fallback candidate | Fly has the selected private-network/API primitives; actual runtime tests decide. One reported host failure is not a universal platform comparison. [FLY3, FLY7, ALT1] |
| Per-run environments | Optional later | **Selected baseline now** | Removes reuse/cleanup assumptions; lifecycle/cost still need proof. No paused/suspended reuse across runs. |
| Primary inference | Baseten event alias | **Direct Meta `muse-spark-1.3`** | First-party, confirmed credit, documented tools and images. [P14–P19] |
| Queue | Redis + BullMQ + ioredis | **BullMQ 6 on Postgres** | One fewer service; ioredis in maintenance. [T9, T10] |
| Runtime | Node 24 | **Node 26 LTS** | Active LTS from Oct 28. [T5, T6] |
| UI components | shadcn/ui | shadcn where icon-free; Radix otherwise | Avoids Lucide. [T8] |
| Video | HyperFrames | **Keep HyperFrames**, plus a plain-editor fallback | All commands verified; Windows works. [H3, H8] |

## Evidence-based fallback and sequencing

The fixed nine-day backlog and dated cut triggers are superseded by R0–R7. The guide-stated event cutoff remains November 5, 2026, 10:00 AM PHT, with unresolved organizer/rule questions in B11; internal dates are planning references only.

- If R1 cannot prove CDP enforcement, compare mitmproxy on the same allowed/denied matrix; do not pile on scope exceptions.
- If R2 cannot prove the Fly profile, evaluate E2B against the same gates and explicitly update/review the selected provider path. A VM alone is not a permission policy.
- If R3 fails, defer secondary providers and optional integrations. Preserve the failing error/output and unknown reservations/actions.
- If R4 fails, improve the baseline workflow/fixture/model loop; do not fill the UI/video with fabricated findings or a ground-truth click script.
- If R5/R6 fails, keep that feature private/closed or honestly disabled; the anonymous live demo still needs its applicable security/money/fixture gates.
- If video rendering fails later, use the permitted plain-editor cut from real footage.

Defer optional provider showcases, Wonder, ZAP/advanced probes, extra browsers/continuous streaming and decorative media first. Do not cut active exploration, ownership/actual-dial egress, fresh-run isolation, credential protection, quotas, evidence, fixed retests or real-site proof to claim progress.

## Findings disposition

- **Changed in v1.4:**
  - real product with verified sites;
  - secret-free browser app instead of a sandbox service;
  - Fly.io hosting;
  - Direct Meta as primary;
  - no Redis;
  - Node 26;
  - framework security floors;
  - Playwright pin;
  - adapter rules;
  - quotas and spend ceiling;
  - production write permission (observation-only remains optional);
  - fallback video cut;
  - scope ladder.
- **Closed:** B13 (registration fact) and B25 (documentation inconsistency). Credit confirmed by Drave (part of B01), not account-audited.
- **Preserved:** macOS design, no Lucide, Playwright core, workflow visualization, mobile emulation, copy-to-coding-AI loop, security catalog.
- **Update 3 verified locally:** queue viability (seven checks), pinned probe build, probe dependency audit, npm availability and Playwright image manifest. None is a deployed application safety proof.
- **Not verified:** runtime gates marked 🔧 beyond their explicitly recorded local component results. Provider access/billing, Fly sandbox/egress, actual scans and video remain unproved.

**Update 4:** planning-only alignment and source/document consistency checks; no new runtime pass, provider call or deployment. R0 does not authorize implementation until Drave starts it.
