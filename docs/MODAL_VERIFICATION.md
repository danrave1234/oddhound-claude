# Modal runtime verification (October 28, 2026)

Owner-approved move from Fly to Modal to stop paying Fly before the hackathon. This replaces the fixed
requirement "one fresh pinned Fly Machine per run … private 6PN … no public service/IP" with "one fresh
pinned Modal Sandbox per run". Every isolation property was re-tested on Modal; what could not be kept is
listed under **Degradations** below. Nothing here is a security certification.

Code: `packages/core/browser/modal-runtime.ts` (`BROWSER_RUNTIME=modal`), `tests/lab/modal-canary.ts`,
`infra/modal/app.py`, `infra/modal/browser_image.py`. Raw results: `docs/evidence/modal-canary-*.json`.

## Versions

| Item | Value |
|---|---|
| Browser image | `apps/browser/Dockerfile` unchanged, built on Modal: `im-6P2J5P3OXzsS65srOXr4Cs` (ENTRYPOINT cleared; the worker passes it as the Sandbox command) |
| Playwright / Chromium | 1.64.1 (same in worker and image) |
| Node | 26 (image `node:26-bookworm-slim`; local runs with Node 26.12.1) |
| Modal | Python client 1.6.3 (deploy/build), JS SDK `modal@0.11.1` (worker, web) |
| Sandbox profile | `runtime: "vm"`, 1 CPU, 2048 MiB, `timeoutMs` 30 min, connect-token control, public-IPv4 outbound allowlist |

## Canary results

`node tests/lab/modal-canary.ts --runtime <gvisor|vm> --outbound <open|public>`, real Modal Sandboxes.

| Profile | Result | Sandbox |
|---|---|---|
| gVisor (Modal default) | **Fails, refuses to start (0/1).** `nft`: "Unable to initialize Netlink socket: Protocol not supported"; no iptables in the image. The entrypoint exits 70 rather than run Chromium without the browser-user firewall (fail closed). User namespaces do work (`unshare -Ur true` = 0). | — |
| `runtime: "vm"`, open outbound | **28/28 pass** | sb-01M60TFXW5QXAQQ3060PMR1CVN, ready in 6.2 s |
| `runtime: "vm"`, public-IPv4 allowlist (**deploy profile**) | **31/31 pass** | sb-01M60TH0BBK7AZ6Z5GBZR5Y77F, ready in 14.1 s |

What the deploy profile showed:

- **Chromium sandbox:** `chrome://sandbox` verdict `sandbox_on` with `chromiumSandbox: true`; all `chrome` processes run as `pwuser`, the proxy as `oddproxy`. No `--no-sandbox`.
- **No platform secrets in the guest:** environment variable names of every guest process recorded; none of DATABASE_URL, Meta key, Modal token, auth/reset secrets or an OIDC identity token. The only Oddhound input is `RUN_WS_PATH`.
- **nftables applied** (`table inet oddhound`, browser-UID rules) under the VM kernel.
- **Browser user (in-guest netcheck as `pwuser`):** direct TCP to a public IP blocked, direct TCP to metadata blocked, direct DNS blocked, UDP blocked (EPERM); via the proxy, metadata, the local control port, 10.0.0.1, `fdaa::3` and port 22 are refused (403); the positive control `example.com:443` is allowed.
- **Browser navigation:** a public HTTPS page loads through the proxy; `169.254.169.254`, `10.0.0.1`, `192.168.0.1`, `127.0.0.1:3000`, `[fd00::1]` and `metadata.google.internal` all get the proxy's own refusal page, each with a matching proxy denial event. (A first version of the canary counted these as failures because it expected a network error rather than the proxy's 403; fixed to require the proxy's body plus its denial log.)
- **Provider-side layer:** with `outboundCidrAllowlist` = public IPv4 only (116 CIDRs, `publicIpv4Cidrs()`), even the proxy user, which the firewall lets dial out, cannot reach metadata or 10.0.0.1, while 1.1.1.1:443 connects.
- **Control endpoint:** no public tunnel is opened. The worker connects with a Sandbox Connect Token (bearer header checked by Modal) plus the random 32-character `wsPath`. Without the token: WebSocket refused and plain HTTP 401.
- **Teardown:** `terminate()` then `poll()` returns exit 137; the Sandbox is no longer listed. **Orphan reaper:** a second Sandbox left behind by a "crashed" worker was found by tag and terminated (exit 137).

## Degradations against the Fly design (documented, not silent)

1. **Control is not on a private network.** Modal has no private network between a Function and a Sandbox (the Sandbox-only `i6pn` option does not cover Functions). The control WebSocket goes through Modal's authenticated proxy on a public `*.w.modal.host` hostname. It is protected by the connect token (checked by Modal before forwarding) and the 192-bit `wsPath`; there is no source-address restriction because the worker's egress IP is not fixed (`inboundCidrAllowlist` is supported but not used). Fly's "control reachable only over 6PN" property is **not** kept.
2. **gVisor is not usable**; the VM runtime is required for the browser-user firewall. Startup is 6–14 s.
3. **`RUN_WS_PATH` is visible to the Modal workspace** (Sandbox env in the dashboard). Only workspace members can see it, and the connect token is still required.
4. **The worker holds a workspace-wide Modal token** (Modal tokens cannot be scoped to one app). Fly's token was scoped to the browser app.
5. **Measured egress bytes:** `egressStats` reports denials only (same as Fly); byte totals stay in the guest proxy.

Unchanged: fresh Sandbox per run, never reused; no volumes; pinned image ID; hard Modal lifetime of
30 minutes (10-minute sign-in wait + 15-minute run clock + 5 minutes); terminate-and-confirm; a reaper
outside the run (each worker start, every 30 s while it runs, at idle exit, and a 15-minute scheduled tick).

## Deployment on Modal

| Component | Modal | Fly equivalent |
|---|---|---|
| Web (Next.js) | `@modal.web_server` `oddhound-web`, scales to zero (120 s window), https://danravekeh123--oddhound-web.us-east.modal.run | `oddhound-claude-web` web process |
| Worker | Function `worker`, one container, started by the web app on enqueue (JS SDK `spawn`), exits after 90 s idle; `tick` every 15 min starts it with a 15 s idle window | `oddhound-claude-web` worker process |
| Browser | Sandbox per run in app `oddhound-browser` | `oddhound-claude-browser` Machines |
| Demo targets | `oddhound-demo`, `oddhound-demo-fixed`, scale to zero (600 s window), one container each (in-memory state) | `oddhound-claude-demo`, `-demo-fixed` |
| Database | unchanged: Neon Postgres (AWS us-east-1) | same |

Secrets are Modal Secrets `oddhound-web` and `oddhound-fixture`, copied from the Fly app with
`infra/modal/copy_secrets.py` (names printed, values never). While Fly still runs against the same database,
the Modal deployment uses its own queue name (`ODDHOUND_RUN_QUEUE=oddhound-runs-modal`): the first Modal
demo run (22cf87fa) was taken by the Fly worker before that change and ran on a Fly Machine.

Problems found and fixed while deploying: the Modal app file read deploy-time settings inside the
container (now baked into each Function's `env`); Modal URLs carry a region (`.us-east.modal.run`); the JS
SDK inside a Modal container tried Modal's root-only local socket (`MODAL_SERVER_URL=unix:/run/modal.sock`)
instead of the token, so Node processes now get `https://api.modal.com` and none of the container-only
Modal variables (including the container's OIDC identity token).

## Real demo-target run on Modal

Run **cff8d393** (anonymous "Try the demo target" on the Modal web app, worker on Modal, real
`muse-spark-1.3-contributor`): **completed** in about 5 minutes, browser `modal:sb-01M60WMRMJRZJCJ809ECK69BNF`,
sandbox `sandbox_on`, Sandbox terminated and confirmed (exit 137). Model spend **$0.021**. 7 findings: party
size 0 accepted, spaces-only guest name accepted, cross-account booking readable, mobile submit covered by
banner, session cookie not Secure, no CSP, pages frameable. The agent registered/signed in, created, edited
and cancelled bookings with two actors.

Not yet run on Modal: the Docker-lab e2e suite (its fixtures live on a local Docker network the Modal
Sandbox cannot reach); GitHub sign-in (the OAuth app's callback points at Fly); retest on the fixed demo
build from the live UI.

## Cost estimate

Rates from Modal's pricing page as given for Sandboxes ($0.0000394/core/s, $0.0000067/GiB/s); Functions
are assumed to cost no more. Not yet reconciled against Modal's usage page.

| Item | Estimate |
|---|---|
| Browser Sandbox, 1 core + 2 GiB | $0.0000528/s: ~$0.01 for a 4-minute run, $0.05 for a full 15-minute run, $0.095 at the 30-minute hard limit |
| Worker, 0.5 core + 1 GiB during a run + 90 s idle | ~$0.01 per run |
| Model (Muse Spark contributor price) | separate, from the Meta credit (run cost shown per run) |
| **Per run (compute)** | **≈ $0.02–0.06** |
| Idle month: tick 96×/day × ~25 s worker | ≈ $1/month |
| Web/demo cold containers | only while used (scale to zero) |
| **Per month** | **≈ $1 idle + $0.02–0.06 per run**, inside the $30/month Starter allowance |

Fly today: ≈ $15–20/month (always-on web/worker and two demo apps).
