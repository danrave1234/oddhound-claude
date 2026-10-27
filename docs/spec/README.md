# Oddhound

**Find what you didn't test.**

Sign in, prove you own your site, and authorize active testing with goals, test accounts or synthetic registration identities, and data/side-effect boundaries. A Meta-model-driven agent explores the site in a real browser and tries the unexpected things real users do. It turns what breaks into evidence-backed findings. Copy the fix brief into your preferred coding AI, ship the fix, and Oddhound replays the same unchanged test.

Built for the **Meta Global AI Developer Hackathon** · Indie Developer track · Theme: *Push the Frontier*.

> **Status (October 27, 2026; executable blocker probes):** The [kernel traffic guard](docs/WIRE_LIMIT_VERIFICATION.md) passes **14 standalone and 68 gateway integration checks**, preserving real active workflows while bounding admitted packet bytes and closing on exhaustion. WS preassembly memory and complete application/deployed gates remain open. **The older CDP worker gate failed a canary regression and is rejected as production containment.** Only B13/B25 are closed (2/27); Meta/Fly credentials remain unconfigured. Start with [AGENTS.md](AGENTS.md) and [Implementation Readiness](docs/IMPLEMENTATION_READINESS.md).

## Try the local test site

- Seeded defect: [Booking lab](http://127.0.0.1:4173).
- Corrected version: [Booking lab, corrected](http://127.0.0.1:4174).

Create an account using any `example.test` address and a disposable password of at least 12 characters. Create/edit/cancel a booking; try `-1` seats in each version. These are synthetic HTTP fixtures, not the public scanner. SQLite belongs to the target fixture only; the planned Oddhound platform still uses PostgreSQL.

With Docker Desktop running, launch and verify from the repository root:

```powershell
docker compose -f tools/active-lab/compose.yaml up -d --build fixture fixed canary
docker compose -f tools/active-lab/compose.yaml run --build --rm lab
```

See [lab instructions](tools/active-lab/README.md) for results, cleanup and scope. The browser/canary have no published ports; only the two fixtures are available on loopback. No inference calls are made.

## Documents

Each topic has one owning document. Other documents summarize and link to it. If two documents disagree, the owner wins.

| Document | Owns | Read when |
|---|---|---|
| [AGENTS.md](AGENTS.md) | Instructions for coding agents: fixed requirements, build slices, reporting (`CLAUDE.md` imports it) | Coding agents read this first |
| [MVP Build Plan](Oddhound-MVP-Build-Plan-v1.4.md) | Scope, architecture, **status vocabulary (§10)**, **run limits and quotas (§8)**, **who can scan what (§17)**, backlog, evaluation | First, always |
| [Plan Audit](Oddhound-Plan-Audit-v1.4.md) | Blocker status B01–B27, risks A01–A30, closure steps and evidence-based fallbacks | Before each slice |
| [Provider & Deployment Plan](Oddhound-Provider-and-Deployment-Plan-v1.4.md) | Meta model endpoints, adapter rules, smoke suite, failover, **browser isolation and egress (§5–6)** | Before any network or model code |
| [Security Test Plan](Oddhound-Security-Test-Plan-v1.4.md) | SEC-01–SEC-11 target tests, SELF-01–SELF-23 self-protection tests | Before any probe or helper that makes requests |
| [Implementation Readiness](docs/IMPLEMENTATION_READINESS.md) | Active-testing walk-through, R0–R7/all-blocker proof crosswalk and readiness verdict | Before implementation or deciding a blocker is closed |
| [Open-source references](docs/OPEN_SOURCE_REFERENCES.md) | Curated reuse/research/evaluation candidates, adoption boundaries and source licenses | Before importing code or choosing an additional test application |
| [Blocker verification record](docs/BLOCKER_VERIFICATION.md) | Actual local outputs, checked versions/digests, chosen site candidates and missing access | To distinguish proof from design |
| [UI/UX Standards](Oddhound-UI-UX-Standards-v1.4.md) | macOS-inspired design, no Lucide, accessibility, setup and verification flow | Before frontend work |
| [HyperFrames Demo Plan](Oddhound-HyperFrames-Demo-Plan-v1.4.md) | Storyboard, evidence rules, video tooling | Video work only, kept separate from the app |
| [Research Register](Oddhound-Research-Sources-v1.4.md) | Every bracketed citation (`[G1]`, `[P…]`, `[T…]`, `[FLY…]`, `[SEC…]`, `[H…]`, …) | When checking a claim |

`archive/v1.3/` holds the previous revision, including the original research register. It's history only; don't build from it.

## Locked decisions

- **Active testing is the product.** After ownership verification and one run-level capability/account/data grant, the agent discovers registration/login, creates/edits/cancels synthetic records and tries unexpected values/order/repeats. No click script or per-click approval. Observation-only is optional; production active writes require explicit owner permission. Each active API origin is verified separately. Unverified active targets/private addresses are refused. Sign-in-free live demo and recorded replay remain separately gated.
- **Quotas protect the credit:** 3 runs per user per day, a daily public spend ceiling with a kill switch, $2 per run, one run per site at a time.
- **Browser:** one **fresh Fly Machine per run** in a separate app without platform credentials, public browser service or persistent volume/profile. Private control, sandboxed Chromium, smokescreen/nftables and a tested permission layer. Destroy/confirm after each run; independent orphan reaper. Fly/CDP are candidates pending proof; E2B/mitmproxy are explicit fallbacks, not working integrations.
- **Models:** **Direct Meta `muse-spark-1.3`** is primary. The backup is Baseten's event alias `meta-models/muse-spark-open-1026` once confirmed, or Fireworks.
- **Data:** one PostgreSQL + Drizzle for data, auth and the queue (BullMQ 6 Postgres backend); private S3-compatible artifacts. No Redis.
- **Stack floors:** Node 26 LTS, `next` ≥ 16.4.3, `react` ≥ 19.3.1 (critical RCE fixes), `playwright@1.64.1`.
- **UI:** Apple/macOS-inspired three-pane workspace. **No Lucide.** Octicons plus original SVGs.
- **Fix loop:** copy the fix brief → fix it outside Oddhound → replay the unchanged assertion. Oddhound never writes to your repo.
- **Demo video:** HyperFrames film of real recordings, about 178 s and never over 180 s, with a plain-editor fallback cut.

### Fresh runtime and a separate permission layer

A new Machine removes cross-run reuse assumptions. It does not decide who may scan what. Ownership/scope, a constrained executor and actual-dial egress remain separate requirements. The policy must allow real registration/login/writes while blocking private destinations, unverified action origins and forbidden effects. Blocking everything is not a passing tester. See [provider §5–6](Oddhound-Provider-and-Deployment-Plan-v1.4.md#5-browser-isolation-one-fresh-fly-machine-per-run).

## Build milestones, not a nine-day task calendar

| Gate | Required proof |
|---|---|
| R0 | Aligned documents and Drave's explicit start instruction; no code yet |
| R1/R2 | Active allowed/denied permission lab + fresh-Machine sandbox/private control/egress/destruction/reaper |
| R3 | Real capped Meta loop, hosted queue, atomic action/spend/compute controls |
| R4 | Autonomous signup/login/discovery and a proved unexpected-input failure, without ground-truth scripts |
| R5 | Tenant/credential/evidence/report protection and original-assertion fix/retest |
| R6 | Two real verified sites including an active account/write workflow; all enabled applicable SELF gates and signed-out entries |
| R7 | Truthful accessible submission artifacts, provenance and rules/access checks |

The full crosswalk is in [Implementation Readiness](docs/IMPLEMENTATION_READINESS.md). The guide-stated Nov 5, 10:00 AM PHT cutoff remains separate; organizer questions are open. No internal date waives safety or fabricates a successful run.

## Questions for the organizers

1. The full judging rubric. The supplied guide shows the criteria table only as `[table]`.
2. Whether the build window starts at kickoff (Oct 26 ET) or Oct 27 ET.
3. Whether earlier mockups, logos or prototype code can be reused in an indie entry, and how to disclose them.
4. Confirmation of the Baseten alias `meta-models/muse-spark-open-1026` and how credits are attributed to it (only if you use Baseten as the backup).

## What changed in v1.4

### Update 4 — active-testing alignment (documentation only)

- Registration/login and state changes are positive acceptance tests. Run-level grants allow novel paths; observation-only is optional.
- A fresh Fly Machine per run replaces reused-Machine cleanup. No control-path discovery endpoint or browser DB access.
- Each active first-party API origin is independently verified and scoped; assets gain no action authority.
- Proof gates replace the nine-day calendar. Runtime gates remain unrun; prior local queue evidence is unchanged.
- Shared requirements have no development-model assignments or coordination workflow. Development remains on hold.

### Update 3 — deeper blocker review and first local proof

- Added B18–B27: redirect/frame scope, production operations, anonymous-demo abuse, atomic spend, cross-run cleanup, control/bootstrap/helper boundaries, resource amplification, incomplete launch gates, hosted queue requirements and build/access prerequisites.
- Corrected the shortened launch gate, the Redis fallback contradiction and the blanket claim that the browser holds no secrets. ~$20 is a compute subtotal, not total hosting cost.
- Local BullMQ 6.4.2 / PostgreSQL 17.11 / Node 26.12.1 probe passed seven checks. Reproduce with `tools/blocker-probes/compose.yaml`; commands, output and limitations are in [the verification record](docs/BLOCKER_VERIFICATION.md).
- Drave delegated real-site selection: MyPortfolio and a safe staging deployment/tenant of EstabWeb. Repo admin access is confirmed; final-origin verification and real scans are pending. Detailed Vercel domain lookup hit a scope authorization error.

### Update 2 — real product and lighter isolation (historical)

- **Real product, not a demo.** Verified-site mode for any GitHub user, re-checked ownership tokens, a read-only default on production sites, per-user quotas and a spend ceiling, and a public-launch gate (SELF-01–05, 07, 08, 13–15). The demo target and replay stay for visitors and judges.
- **No sandbox service.** A secret-free Fly browser app plus Chromium's sandbox plus the smokescreen proxy replaces Modal per-run sandboxes. It has to be a **separate Fly app**, because Fly gives an app's secrets to every Machine in that app.
- **Blockers:**
  - B13 (registration) is closed, and the $150 credit is confirmed.
  - The then-current design fixes listed runtime proofs; update 3 found further gaps, so this was not complete closure.
  - New: B16 (verification bypass), B17 (credit exhaustion), SELF-14/15.
- **`AGENTS.md` replaces the AI-coder handoff**, and `CLAUDE.md` imports it.
- **New sources:** FLY1–6, PW1–2, EGR1–2 and VER1 in the research register.

### Source recheck (October 27)

- **Inference:** primary switched to Direct Meta. Adapter rules added: `tool_choice: "auto"` only, images in user messages, no `stop`/`logprobs`, structured output via tool arguments. The primary and backup are different models.
- **Stack:** Redis dropped (BullMQ 6 on Postgres); Node 26 LTS plus Next.js/React security floors; Playwright pinned to 1.64.1.
- **Video:** HyperFrames commands verified; Windows notes and a fallback cut added.
- **Register:** merges the real v1.3 sources with recheck markers.

### Consistency pass

- **One copy of each shared spec:** status vocabulary (MVP §10), run-limits table (§8), UI spec (UI/UX doc) and storyboard (HyperFrames §4).
- **Shared terms:** findings use the same four groups everywhere, and the security table maps to SEC/SELF IDs.
- **Repo layout:** shows where each planning doc goes under `docs/`.
- **Small fixes:** nine-day build window; npm lockfile for the video project.
