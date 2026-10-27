# Oddhound — Find what you didn't test.

> **Work in progress for the Meta Global AI Developer Hackathon (Indie Developer track).**
> Built during the event, starting October 27, 2026. This repository is one of two parallel implementations of the same specification (`docs/spec/`); only one will be submitted.

Oddhound is an active exploratory-testing agent for web apps. A developer verifies they own a site, approves a run contract (goals, rules, permitted test actions), and a Meta-model-driven agent explores the site in a real, isolated browser: it registers synthetic accounts, completes workflows, tries unexpected inputs and orderings, checks a phone-sized screen and a second account, and turns rule violations into **independently replayed, evidence-backed findings**. The developer copies a fix brief into their own coding AI; Oddhound then replays the **unchanged** assertion to confirm the fix.

## Status (honest)

| Area | State |
|---|---|
| Meta inference (`muse-spark-1.3`, Direct Meta API) | Smoke suite passes against the real API (`docs/PROVIDER_SMOKE_TESTS.json`) |
| Agent loop, tools, action ledger, spend ledger, fencing | Implemented; exercised end to end |
| Browser isolation | Secret-free `oddhound-browser` image: non-root Chromium with its sandbox on, SSRF egress proxy, nftables. One fresh container per run locally; Fly Machine runtime written but **not yet tested on Fly** |
| Verification + retest | Each candidate replayed twice in fresh sessions plus a valid control; retest replays the saved assertion hash |
| Demo target | `apps/fixture`: booking app with five labelled defects and a corrected build |
| Web UI (Next.js, macOS-inspired, no Lucide) | In progress |
| Deployment | Not deployed yet |

End-to-end lab test (offline test double): 15/15 checks pass — all four seeded behavioural defects are found and verified, the valid controls are not flagged, every finding is marked fixed on the corrected build, and nothing is marked fixed on the unfixed build.

## Layout

```text
apps/fixture   demo target (Harbor Table) with seeded defects and a --fixed build
apps/browser   secret-free per-run browser image (Playwright server, egress proxy, nftables)
apps/worker    queue consumer (BullMQ 6 on PostgreSQL) + reapers
apps/web       Next.js UI and API (in progress)
packages/core  contracts, ledgers, SSRF policy, ownership verification, providers, agent, verifier, reports
tests/         e2e lab harness, provider smoke suite, lab control
docs/spec      the shared planning documents this build follows
```

## Run locally

Requires Node 26, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env          # add META_API_KEY to use real Meta inference
node tests/lab/lab.ts up      # builds images, starts Postgres and the demo target on an isolated network
node --env-file=.env packages/core/db/migrate.ts
node --env-file=.env tests/e2e/run-e2e.ts                       # offline test double
E2E_PROVIDER=meta node --env-file=.env tests/e2e/run-e2e.ts     # real Meta model (spends credits)
```

## Licence and provenance

Original code written for this hackathon. `infra/docker/playwright-seccomp-profile.json` is from the Playwright repository (Apache-2.0). Dependencies keep their own licences.
