# Oddhound — Find what you didn't test.

> **Work in progress for the Meta Global AI Developer Hackathon (Indie Developer track).**
> Built during the event, starting October 27, 2026. This repository is one of two parallel implementations of the same specification (`docs/spec/`); only one will be submitted.

Oddhound is an active exploratory-testing agent for web apps, driven by **Meta Muse Spark**:

1. **You prove ownership** of a site with a DNS record, a `/.well-known` file or a meta tag.
2. **You approve a run contract**: goals, rules, permitted test actions.
3. **Oddhound explores** in a fresh, isolated, secret-free browser. It signs up synthetic accounts, completes workflows, and tries boundary values, blank input, odd orderings, a second account and a phone-sized screen.
4. **Every suspected rule violation is replayed independently**, twice, in fresh sessions with a valid control, before it is called **verified**.
5. **You copy a fix brief** into your coding AI, then **retest**. Oddhound replays the exact, unchanged assertion.

**Full honest status: [docs/STATUS.md](docs/STATUS.md).** Highlights:

- **Real model:** Muse Spark 1.3 autonomously found and verified all four seeded defects on the demo target, with no click script. On the corrected build every finding flipped to *fixed*.
- **Automated tests:**
  - 70/70 unit and integration tests;
  - 15/15 end-to-end lab checks;
  - 13/13 HTTP tenant-isolation checks;
  - 10/10 in-container network checks;
  - 9/9 live provider smoke checks.
- **First real verified site:** `www.danravekeh.com` was verified with a `/.well-known` file and scanned by Muse Spark in observation-only mode. A second real site and the public deployment are still open (see the status doc).

## Layout

```text
apps/fixture   demo target (Harbor Table) with five labelled defects and a --fixed build
apps/browser   secret-free per-run browser image: Playwright server (non-root, sandboxed Chromium), SSRF egress proxy, nftables
apps/worker    queue consumer (BullMQ 6 on PostgreSQL) + reapers for stale runs and orphan browsers
apps/web       Next.js 16 UI + API: landing, demo target, replay, projects, verification, run workspace, findings, reports, status
packages/core  contracts, ledgers (runs/spend/credentials), SSRF policy, ownership verification, Meta adapter,
               agent loop + tools, verifier (scenarios), reports (fix brief, Playwright export), Context7 (MCP v2)
infra/         Playwright seccomp profile, Fly app configs (untested)
tests/         unit + integration (vitest), e2e lab harness, HTTP access checks, provider/Context7 smoke, no-Lucide lint
docs/spec      the shared planning documents this build follows
```

## Run locally

Requires Node 26, pnpm 11 and Docker.

```bash
pnpm install
cp .env.example .env                       # add META_API_KEY for real Meta inference; set ARTIFACT_DIR to an absolute path
node tests/lab/lab.ts up                   # builds images, starts Postgres and the demo target on an isolated network
node --env-file=.env packages/core/db/migrate.ts
npx vitest run                             # unit + integration tests (uses the oddhound_test database)
node --env-file=.env tests/e2e/run-e2e.ts  # full lab run with the offline test double
E2E_PROVIDER=meta node --env-file=.env tests/e2e/run-e2e.ts   # same with the real Meta model (~$0.15–0.25)
node --env-file=.env apps/worker/main.ts   # worker
cd apps/web && node scripts/next-with-env.mjs dev --port 3310 # web app at http://127.0.0.1:3310
```

## Licence and provenance

Original code written for this hackathon. `infra/docker/playwright-seccomp-profile.json` comes from the Playwright repository (Apache-2.0). Dependencies keep their own licences.
