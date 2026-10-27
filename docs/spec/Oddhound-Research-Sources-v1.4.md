# Oddhound — research and source register

**Revision:** 1.4 · **Reviewed:** October 27, 2026

This register separates three things: the supplied event guide, external documentation, and Oddhound's own engineering decisions. Every bracketed source ID in the planning docs resolves here.

v1.4 merges the v1.3 register (archived in `archive/v1.3/`) with a **same-day recheck on October 27, 2026**, which read the official pages and the npm registry. Documentation support is not proof that an integration has run with Drave's account. No provider call, billing check, deployment, scan or render was performed.

**Update 3:** the blocker review rechecked the specific sources below and ran a local disposable queue probe. This does not freshly validate every older register entry or G1 (the uploaded original is absent from the repository). Actual commands, versions, image digests and output are recorded in `docs/BLOCKER_VERIFICATION.md` and `docs/VERSIONS.md`. Provider calls, Fly deployment and scans remain unperformed.

**Update 4 (planning only):** rechecked the Fly Machine lifecycle API, Chromium Fetch interception, Playwright interception/network exposure and the E2B/mitmproxy alternatives. This is source support, not runtime proof. No new package/price/account/sandbox/scan test is claimed. Fresh per-run Machines, capability grants, API verification scope and proof gates are Oddhound design decisions.

**Recheck markers:** ✅ confirmed on the page during the v1.4 recheck · ⚠️ the page changed the plan (see the Notes column) · — not rechecked in v1.4.

## Supplied competition evidence

**G1 — Meta Global AI Developer Hackathon Participant Guide**, uploaded as `Pasted text.txt`. Relevant extracted lines:

- 9–15: themes and the required use of Meta models.
- 51–87: Eastern Time schedule and stated building period.
- 91–103: public repository, maximum four participants, new work, contribution disclosure, prohibited projects.
- 107–118: $150 Meta credits, credit-card requirement, spend-limit notification.
- 148–166: conditional partner support; Baseten's $100 / 2M TPM offer and the required event model ID `meta-models/muse-spark-open-1026`.
- 172–188: Modal's conditional $100 offer and Fireworks' conditional $25/team offer.
- 192–200: submission, publicly accessible artifacts, three-minute video.
- 206–214: pass/fail stage for Meta use; equally weighted rubric whose details appear only as `[table]`.

These still need confirming with the organizers or in the accounts: the public event waiver (which could not be fetched), the missing rubric rows, account-specific offers, final rules, which uses partner credits are eligible for, and the exact permitted start. Do not fill those gaps from assumptions. The Baseten event alias comes from the guide, not from a provider's generic product example.

**G2 — secondary event summary (not authoritative).** https://www.sequenzy.com/api/email-examples/j5iypr0umhagob6hpglchdwg/html is an email-style page found during the v1.4 recheck. It describes the event as virtual, Oct 26 – Nov 4, with Indie Developer and Startup tracks, $150 in Meta API credits and a $1M prize pool. It also says **applications closed October 25**. Use it only as a prompt to confirm registration, never as a rules source. No official public rubric was found. **Update (Oct 27):** Drave confirmed being registered, with the $150 Meta (Muse) API credit, so this concern is closed.

## HyperFrames — official HeyGen sources

| ID | Primary source | What it supports | v1.4 recheck |
|---|---|---|---|
| H1 | https://github.com/heygen-com/hyperframes | Official repository; HTML/media/seekable animation; Node.js 22+, FFmpeg/FFprobe and Chrome; Apache-2.0; separate CLI, engine and producer packages. | ✅ npm `hyperframes` is at 0.8.x: pre-1.0 and released often, so pin it exactly. |
| H2 | https://hyperframes.heygen.com/quickstart | Skill workflow for AI coding agents; `npx hyperframes skills update`; local rendering; optional external-service costs. | ✅ |
| H3 | https://hyperframes.heygen.com/packages/cli | `lint`, `check --snapshots`, `preview`, `render --output/--fps/--quality`, `doctor --json`. | ✅ Every planned command and flag exists. `doctor` exits 0 whenever it runs; gate on `.ok`. `check --strict` makes warnings fail. Built-in `tts` (local Kokoro) and `transcribe` (whisper-cpp/Parakeet, `.srt`/`.vtt`). |
| H4 | https://hyperframes.heygen.com/concepts/determinism | Seek-based frame rendering and deterministic composition. | ✅ Don't call `play()` or set `currentTime` in scripts. `render --docker` pins fonts, Chrome and FFmpeg. |
| H5 | https://hyperframes.heygen.com/guides/rendering | Render pipeline and output formats. | ✅ `--quality high` equals `delivery`; MP4 is the default. |
| H6 | https://hyperframes.heygen.com/ | Desktop Studio availability (macOS/Linux; Windows "coming soon"). | ✅ Studio is not required. |
| H7 | https://hyperframes.heygen.com/introduction | Agent-built, editable video projects. | — |
| H8 | https://hyperframes.heygen.com/help | Windows notes: render natively from PowerShell in a `C:\` folder; WSL2 can fall back to slow software rendering; FFmpeg must be on PATH. | ✅ new |
| H9 | https://github.com/heygen-com/hyperframes/issues | Open Windows issues as of Oct 27: #4845 (Smart App Control blocks `sharp`, which can break `check --snapshots`), #4058 (ffmpeg EBUSY), #4060 (false disk-space check), #5653 (console window stays open). Docker stall with two simultaneous `<video>` elements: #5473. | ✅ new |
| H10 | https://github.com/remotion-dev/remotion/blob/main/LICENSE.md | Remotion licence: free for individuals and companies of up to 3 people. The alternative, not selected. | ✅ new |

Do not rely on lookalike domains or third-party repository directories as the installation authority. Pin the CLI and record the installed skill revision.

## Model providers and browser infrastructure

| ID | Primary source | What it supports | v1.4 recheck |
|---|---|---|---|
| P1 | https://docs.baseten.co/inference/model-apis/overview | Managed model APIs; OpenAI-compatible; `https://inference.baseten.co/v1`. | ⚠️ **Muse Spark Open has no structured outputs or JSON mode on Baseten.** Also: `n>1` returns 400, `seed` and `temperature: 0` are not reproducible, tool calling is supported, and synchronous requests have zero retention. The page does not mention a `-1026` event alias. |
| P2 | https://docs.baseten.co/inference/function-calling | Tool calling. | ✅ `tool_choice` accepts auto, required, none or a named function. |
| P3 | https://docs.baseten.co/inference/model-apis/vision | Image requests. | ✅ `meta-models/muse-spark-open` takes images: up to 8 per request, 10 MB each. |
| P4 | https://www.baseten.co/library/muse-spark-open/ | Baseten lists Muse Spark Open; not validation of the event alias. | ✅ $1.25 in / $0.15 cached / $4.25 out per 1M tokens; context length not stated. |
| P5 | https://fireworks.ai/models/fireworks/muse-spark-open | `accounts/fireworks/models/muse-spark-open`: serverless, tools, images. | ✅ 1,040k context; same price as Baseten; rate limits not listed. |
| P6 | https://docs.fireworks.ai/guides/function-calling | Application-executed tool loop; `https://api.fireworks.ai/inference/v1`. | ✅ `json_schema` output exists in general but is not confirmed for this model; check the model's `supportsTools` field. |
| P7 | https://docs.fireworks.ai/guides/security_compliance/data_handling | Open-model handling vs Responses API storage. | ✅ Open models keep zero data by default (metadata only); the Responses API retains 30 days with `store=True`. |
| P8 | https://docs.fireworks.ai/guides/security_compliance/data_security | Provider security documentation; not certification of Oddhound. | — |
| P9 | https://modal.com/docs/guide/sandboxes | Ephemeral execution primitives and lifecycle. | ⚠️ Sandboxes run on **gVisor or a VM runtime**. The page says nothing about non-root execution or Chromium. |
| P10 | https://modal.com/docs/guide/sandbox-networking | Default public egress; restricted networking; beta domain controls; DNS caveats. | ⚠️ The domain allowlist is **beta, TLS on 443 only, SNI-matched**, and doesn't support ECH; domain fronting is a known gap. **DNS is unrestricted** unless all networking is blocked. Nothing about IPv6, redirects or WebSockets. `outbound_cidr_allowlist` is deny-by-default. The inbound allowlist is not enforced on unencrypted tunnels; use `encrypted_ports` and connect tokens. |
| P11 | https://modal.com/docs/guide/sandbox-sidecars | Independent sidecar network policies. | ⚠️ Beta. Policies can't change after creation, and sidecars can reach the connect-token port directly. Don't depend on them. |
| P12 | https://modal.com/docs/guide/endpoints | Managed inference endpoints, separate from sandboxes. | ✅ OpenAI-compatible; per-endpoint base URL; proxy-token auth. |
| P13 | https://modal.com/blog/meta-muse-spark-open-now-available-on-modal | Muse Spark Open on Shared Endpoints. | ⚠️ The model ID there is `meta-models/Muse-Spark-Open-816B-A42B`, **different from Baseten's**. Vision is not stated. |
| P14 | https://dev.meta.ai/models/muse-spark | Muse Spark 1.3; Standard/Contributor modes. | ✅ `muse-spark-1.3` costs $1.25 / $0.15 / $4.25 and is not used for training. The Contributor mode costs $0.10 / $0.002 / $0.20 and is used for training. 1M context; image input. |
| P15 | https://dev.meta.ai/docs/cookbook/tool-function-calling | Meta function-calling workflow. | ⚠️ **`tool_choice` accepts only `"auto"`**; `required`, `none` and named functions return 400. Replay the assistant message containing `tool_calls` before sending tool results. Several tool calls per turn are allowed. |
| P16 | https://dev.meta.ai/docs/cookbook/quickstart-chat-completions | Chat Completions compatibility. | ⚠️ Context is 1,048,576 tokens. **`stop`, `logit_bias` and `logprobs` return 400.** Default temperature 1.0; per-team rate limits shown in `x-ratelimit` headers. |
| P17 | https://dev.meta.ai/docs/cookbook/github-agent | Example using `https://api.meta.ai/v1`. | ✅ Shows 131,072 max output tokens. |
| P18 | https://docs.baseten.co/inference/model-apis/pricing-and-limits | Baseten account limits. | ⚠️ new. **A basic, unverified account gets 15 RPM / 100k TPM.** Verify the account early; the 2M TPM grant is conditional. |
| P19 | https://dev.meta.ai/docs/image-understanding | Meta image input rules. | ⚠️ new. **Images are accepted only in `user`-role messages**, not in tool results: up to 50 images, 50 MB each, as URL, base64 or `file_id`. |
| P20 | https://dev.meta.ai/docs/tool-search | Meta tool search. | ⚠️ new. Responses/Messages APIs only, **not Chat Completions**; can't be combined with `json_schema`. |
| P21 | https://dev.meta.ai/docs/prompt-caching | Meta prompt caching. | ✅ new. Automatic; optional `prompt_cache_key`. |
| P22 | https://dev.meta.ai/models/muse-wonder | Muse Wonder. | ✅ new. `muse-wonder-1.0`, $4 in / $20 out, 1M context; positioned for computer use. |
| P23 | https://modal.com/docs/guide/sdk-javascript-go | Modal JS/Go SDK. | ⚠️ new. **Beta.** npm `modal` 0.11.x covers sandboxes, connect tokens and an alpha `updateNetworkPolicy`. |
| P24 | https://modal.com/pricing | Modal compute pricing. | ✅ new. Sandboxes cost about $0.14 per core-hour plus memory; the Starter plan includes $30/month. |

Advertised capabilities still need a real request with the chosen model, endpoint and account. A shared wire format does not guarantee identical schema handling, image support, caching, reasoning fields or retention. **Direct Meta `muse-spark-1.3` and partner-hosted Muse Spark Open are different models.** Evaluate both on the same tasks before relying on failover. No partner grant has been verified as credited.

## Browser-sandbox alternatives (v1.4 recheck)

| ID | Source | Key facts for Oddhound |
|---|---|---|
| ALT1 | https://docs.e2b.dev/sandbox/internet-access | E2B: Firecracker microVM; `allowOut`/`denyOut` by IP, CIDR or domain (domains on ports 80/443 only); allow rules beat deny rules; **blocked connections "may appear successful"**. TS SDK. |
| ALT2 | https://www.browserbase.com/pricing and its Playwright quickstart | Browserbase: `connectOverCDP`; `allowedDomains` restricts **top-level navigations only**; no control over launch flags. Free tier 1 hour; $20/month for 100 hours. |
| ALT3 | https://docs.steel.dev/overview | Steel: CDP connection, recordings, self-hostable; proxy features but no documented allowlist. |
| ALT4 | https://developers.cloudflare.com/browser-run/playwright/ | Cloudflare Browser Run (formerly Browser Rendering): `@cloudflare/playwright` fork inside a Worker; no documented egress controls; no video. |
| ALT5 | https://www.daytona.io/docs/en/network-limits/ | Daytona: domain allowlist (≤100 entries); CIDR list is IPv4-only, ≤10 entries; lower tiers can't override org-level rules. |
| ALT6 | https://docs.fly.io/machines/guides-examples/network-policies | Fly Machines: egress policies cover ports and protocols only, not destinations. |

## Browser hosting, egress and site verification (v1.4 update 2)

| ID | Source | Key facts for Oddhound |
|---|---|---|
| FLY1 | https://docs.fly.io/launch/processes | ✅ Each process group runs in its own Machines from the same image. |
| FLY2 | https://docs.fly.io/apps/secrets | ⚠️ App secrets are set on **every Machine in the app**, with no per-group scoping. So the browser must be a **separate app**. |
| FLY3 | https://docs.fly.io/networking/private-networking | ✅ Apps in one organization share the 6PN WireGuard IPv6 network (`<app>.internal`); other orgs can't reach it. |
| FLY4 | https://community.fly.io/t/kernel-nftables-support/17669 | ✅ (community) Fly Machine kernels support nftables. User namespaces are not documented, so check on day 1. |
| FLY5 | https://docs.fly.io/about/pricing | ✅ shared-cpu-2x 2 GB about $13.39/month; shared-cpu-1x 1 GB about $6.70/month; billed per second. |
| FLY6 | https://station.railway.com/questions/playwright-chromium-sandbox-fails-with-c-389a89df | ⚠️ Sept 2026 Railway thread: non-root Chromium with its sandbox fails, with no fix. This is why Railway was rejected. Render has no official guidance. |
| PW1 | https://playwright.dev/docs/api/class-browsertype | ✅ `launchServer` `wsPath` defaults to an unguessable string; `host` defaults to localhost; `connect()` needs a matching major.minor version; **`chromiumSandbox` defaults to false**. |
| PW2 | https://playwright.dev/docs/api/class-browser#browser-new-context | ✅ `serviceWorkers: 'block'` exists (default `'allow'`). |
| EGR1 | https://github.com/stripe/smokescreen | ✅ Active (last commit Oct 22, 2026). HTTP CONNECT proxy; resolves DNS itself and checks the IP it actually connects to; blocks loopback, private (incl. fc00::/7), link-local, CGNAT, NAT64 and host IPs; extra `--deny-range`. |
| EGR2 | https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md | ✅ Loopback and link-local bypass the proxy by default (`<-loopback>` disables that). With an HTTP proxy, DNS resolution goes to the proxy. WebSockets use the proxy. WebRTC/UDP not covered, so block it with nftables. |
| VER1 | https://support.google.com/webmasters/answer/9008080 | ✅ Precedent for site ownership: HTML file, meta tag or DNS record, with periodic re-checks of the token. |
| FLY7 | https://docs.fly.io/machines/api/machines-resource | Update 4: create/delete/private-address and auto-destroy primitives support a candidate fresh-Machine lifecycle. API calls can fail; a modification lease is not a workload TTL. Our orchestration/reaper still need deployed proof. |
| NET1 | https://docs.mitmproxy.org/stable/concepts/how-mitmproxy-works/ | Established HTTPS interception alternative; browser CA trust changes the TLS path. Not selected/installed; preserve upstream validation and disclose evidence limitations. |
| NET2 | https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest and https://playwright.dev/docs/chrome-extensions | Alternative research: browser-native request rules exist, but Playwright extensions require persistent Chromium contexts. Not selected; do not silently replace fresh actor-context semantics or add another browser stack. |
| PW3 | https://playwright.dev/docs/api/class-browsertype#browser-type-connect-option-expose-network | Update 3: `exposeNetwork` shares the connecting client's network with the remote browser; leave it unset. Private remote hosting alone is insufficient if this is enabled. |
| PW4 | https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket | Update 3: register `routeWebSocket` before pages; HTTP-method routing is not a message policy. Service workers, frames and redirect handling require their own coverage. |
| PW5 | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Fetch.pdl | Update 3: CDP Fetch can pause at request/response stages and fail/continue requests. Candidate enforcement primitive only; Oddhound must prove attachment and redirect/frame coverage. |
| EGR3 | https://raw.githubusercontent.com/stripe/smokescreen/master/pkg/smokescreen/config.go | Update 3: listen address, allow/deny ranges, precedence and optional request/tunnel limits are configuration, not proof of the deployed policy. Do not create broad production allow exceptions; bind loopback. HEAD source is not a pinned release. |
| HTTP1 | https://www.rfc-editor.org/rfc/rfc9110.html#name-safe-methods | Update 3: HTTP defines safe-method semantics, but implementations can expose unsafe actions via GET; operation permission cannot be inferred solely from a method. |

## Security references

| ID | Primary source | Application to Oddhound |
|---|---|---|
| SEC1 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/ | Stable WSTG v4.2 testing taxonomy. |
| SEC2 | https://asvs.owasp.org/ | ASVS 5.0.0 requirements: map a subset, never claim compliance. |
| SEC3 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References | WSTG-ATHZ-04: controlled multi-account object authorization. |
| SEC4 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema | WSTG-ATHZ-02: authorization independent of visible navigation. |
| SEC5 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/06-Session_Management_Testing/06-Testing_for_Logout_Functionality | WSTG-SESS-06: logout and server-side session behavior. |
| SEC6 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/06-Session_Management_Testing/05-Testing_for_Cross_Site_Request_Forgery | WSTG-SESS-05: cross-site request forgery. |
| SEC7 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing | WSTG-CLNT-07: browser-enforced cross-origin behavior. |
| SEC8 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/11-Client-side_Testing/09-Testing_for_Clickjacking | WSTG-CLNT-09: framing and sensitive UI. |
| SEC9 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/07-Input_Validation_Testing/01-Testing_for_Reflected_Cross_Site_Scripting | WSTG-INPV-01: reflected script testing in context. |
| SEC10 | https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/10-Business_Logic_Testing/README | Business rules, workflow order, repeat use, timing and upload test families. |
| SEC11 | https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html | Interpreting HTTP security headers in context. |
| SEC12 | https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html | Defending against instructions in untrusted pages, documents or tool output. |
| SEC13 | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html | Validation plus network restrictions; destination and redirect risks. |
| SEC14 | https://www.zaproxy.org/docs/docker/baseline-scan/ | Baseline adds spider traffic before passive analysis; it is not a zero-request import of existing evidence. |

The mode names, test priorities, caps, proof requirements, UI classifications and fallback behavior in the security plan are **Oddhound design decisions**, not OWASP mandates. Do not reproduce source payload collections or imply OWASP endorsement.

## Runtime and dependency audit

| ID | Primary source | Result | v1.4 recheck |
|---|---|---|---|
| T1 | https://playwright.dev/docs/docker | Root launch by default disables the Chromium sandbox; the image is not a complete boundary against hostile sites; client and server versions must match. | ✅ For untrusted sites, run as `pwuser` with Playwright's seccomp profile, plus `--init` and `--ipc=host`. Image tag `mcr.microsoft.com/playwright:v1.64.1-noble`, matching npm exactly. |
| T2 | https://playwright.dev/docs/network | Interception and service-worker limits. | ⚠️ `page.route()` is not called again for redirects, and service workers can hide requests. **Routing is not an egress control.** |
| T3 | https://playwright.dev/docs/release-notes | The v1.3 audit saw 1.62 as the top entry. | ⚠️ **Resolved: latest stable is 1.64.1** (npm, published Oct 14, 2026; Chromium 156). `next` is 1.65 alpha. |
| T4 | https://github.com/modelcontextprotocol/typescript-sdk | Stable v2; split client/server packages; 2026-07-28 spec. | ✅ `@modelcontextprotocol/client` 2.4.x is correct. `@modelcontextprotocol/sdk` 1.x is legacy; don't install it. |
| T5 | https://nodejs.org/en/about/previous-releases | Node 24 LTS. | ⚠️ **Node 26 becomes Active LTS on Oct 28, 2026**; Node 24 moved to maintenance on Oct 20 (supported to Apr 2028). See T6. |
| T6 | https://github.com/nodejs/Release/blob/main/schedule.json | Node release schedule. | ✅ new. Source for the T5 dates. |
| T7 | https://github.com/vercel/next.js/security/advisories · https://github.com/facebook/react/security/advisories | Framework security advisories. | ⚠️ new. **Critical RCE advisories (Oct 14, 2026):** GHSA-673q-mjm6-r5xr and GHSA-2464-fhr4-w9xw for Next (fixed in 16.4.1; latest 16.4.3), and GHSA-xqc2-xf4c-x3h3 for React RSC (fixed in 19.3.1). |
| T8 | https://github.com/shadcn-ui/ui/blob/main/packages/registry/src/icons/libraries.ts | shadcn icon libraries. | ⚠️ new. Defaults to `lucide`; supports lucide, tabler, hugeicons, phosphor and remixicon. **Octicons is not an option.** |
| T9 | https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md | BullMQ 6. | ⚠️ new. BullMQ 6.0 (Jul 30, 2026) adds a **PostgreSQL backend** (PostgreSQL 13+). Breaking changes: no bundled ioredis; `repeat` replaced by Job Schedulers. Redis is still called "most battle-tested". |
| T10 | https://github.com/redis/ioredis | ioredis status. | ⚠️ new. Best-effort maintenance; its README recommends node-redis for new projects. |
| T11 | https://github.com/upstash/context7 · https://context7.com/plans | Context7 MCP. | ✅ new. Tool names `resolve-library-id` and `query-docs` are correct. Remote endpoint `https://mcp.context7.com/mcp` with a Bearer key (recommended). Free tier: 1,000 calls/month. |
| T12 | https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/github.mdx | Better Auth GitHub provider. | ✅ new. Needs the `user:email` scope; a GitHub App needs "Email addresses: read-only". |
| T13 | https://registry.npmjs.org/ | Latest stable versions on Oct 27, 2026. | ✅ new. next 16.4.3, react 19.3.1, tailwindcss 4.3.3, @xyflow/react 12.12, @dagrejs/dagre 3.1, react-resizable-panels 4.15, motion 14.6, zod 4.6, better-auth 1.7, drizzle-orm 0.45 (1.0 is RC), bullmq 6.4, playwright 1.64.1, @axe-core/playwright 4.14, lighthouse 13.5, openai 7.44, vitest 5.0, fast-check 4.10, pino 10.4. |
| T14 | https://docs.bullmq.io/guide/postgresql | Update 3 queue deployment review. | PostgreSQL backend requires explicit migrations and `pg`; long-lived LISTEN connections are separate from pools. Custom pg.Pool needs schema/search_path setup. Seven local checks passed on 6.4.2; hosted behavior is pending. |
| T15 | https://docs.bullmq.io/guide/workers/cancelling-jobs | Update 3 cancellation review. | Worker processor receives an AbortSignal; `cancelJob` is cooperative. Browser shutdown and application lease fencing must be implemented separately. |

Install-time acceptance still requires published package availability, licence review, security-advisory review, compatible patches and a committed lockfile and image digest.

## Open-source reference shortlist (update 4, October 27, 2026)

| ID | Primary source | Checked relevance / limit |
|---|---|---|
| OSS1 | https://github.com/microsoft/playwright-mcp | README accessibility snapshots/tool design; Apache-2.0 license. Study/adapt reviewed pieces, not an unrestricted second controller. |
| OSS2 | https://github.com/vercel-labs/agent-browser | README compact snapshot refs and interaction behavior; Apache-2.0. Current runtime is a separate Rust/CDP daemon, so reference only for the selected one-Playwright architecture. |
| OSS3 | https://github.com/realworld-apps/realworld | Canonical location after redirect from gothinkster/realworld; shared app/API/test specifications and implementation catalog. MIT main repo; linked implementations/logos have separate considerations. Select/pin/self-host an implementation before testing. |
| OSS4 | https://github.com/juice-shop/juice-shop | README deliberately insecure security-tool/training app with Docker/source setup; MIT license text. Optional owned isolated lab, not a public-demo scan target or blanket expanded probe scope. |
| OSS5 | https://github.com/ServiceNow/BrowserGym | README task/evaluation ecosystem and research-not-consumer warning; Apache-2.0. Methodology reference, not a second production agent framework. |
| OSS6 | https://github.com/web-arena-x/webarena | README self-hostable web-agent environment/canonical benchmark code; Apache-2.0 code. Optional evaluation/reset methodology; app images/data require separate provenance checks. |

No shortlist repository was cloned/installed/run, and no external code/assets were imported. [Open-source References](docs/OPEN_SOURCE_REFERENCES.md) records recommended adoption order and boundaries. These source checks do not prove a working integration or authorize third-party live-site testing.

## S — technical references (v1.0–v1.2, checked October 26, 2026)

Kept for traceability. They are not proof of current releases. Several are superseded by the P and T entries above, as noted.

- **S1:** Playwright release notes — https://playwright.dev/docs/release-notes (see T3)
- **S2:** Node.js release guidance — https://nodejs.org/en/about/previous-releases (see T5)
- **S3:** Playwright Docker/security notes — https://playwright.dev/docs/docker (see T1)
- **S4:** Official Playwright MCP, including security warnings — https://github.com/microsoft/playwright-mcp
- **S5:** Official MCP TypeScript SDK v2 — https://github.com/modelcontextprotocol/typescript-sdk (see T4)
- **S6:** Next.js 16.2 — https://nextjs.org/blog/next-16-2 (superseded: use ≥16.4.3, see T7)
- **S7:** React 19.2 — https://react.dev/blog/2025/10/01/react-19-2 (superseded: use 19.3.1, see T7)
- **S8:** Muse Spark 1.3 model, modes, pricing — https://dev.meta.ai/models/muse-spark (see P14)
- **S9:** Muse Wonder and API availability — https://dev.meta.ai/models/muse-wonder (see P22)
- **S10:** Meta-compatible client quickstart — https://dev.meta.ai/docs/cookbook/quickstart-chat-completions (see P16)
- **S11:** agent-browser observation/reference design — https://github.com/vercel-labs/agent-browser
- **S12:** BullMQ retries — https://docs.bullmq.io/guide/retrying-failing-jobs
- **S13:** Meta tool search — https://dev.meta.ai/docs/tool-search (see P20)
- **S14:** Meta prompt caching — https://dev.meta.ai/docs/prompt-caching (see P21)
- **S15:** fast-check — https://github.com/dubzzz/fast-check
- **S16:** Context7 MCP tools — https://github.com/upstash/context7 (see T11)
- **S17:** Meta Model Cookbook — https://github.com/meta-models/meta-model-cookbook
- **S18:** Playwright emulation — https://playwright.dev/docs/emulation
- **S19:** Playwright/axe accessibility testing — https://playwright.dev/docs/accessibility-testing
- **S20:** Lighthouse overview — https://developer.chrome.com/docs/lighthouse/overview
- **S21:** ZAP baseline scan — https://www.zaproxy.org/docs/docker/baseline-scan/
- **S22:** React Flow layouting — https://reactflow.dev/learn/layouting/layouting
- **S23:** Motion for React — https://motion.dev/docs/react
- **S24:** Better Auth — https://github.com/better-auth/better-auth (see T12)
- **S25:** Drizzle ORM — https://github.com/drizzle-team/drizzle-orm

## UX — interaction and accessibility references (checked for revision 1.1, October 26, 2026)

- **UX1:** Playwright Trace Viewer — https://playwright.dev/docs/trace-viewer
- **UX2:** GitHub Actions visualization graph — https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph
- **UX3:** Chrome DevTools panels and device mode — https://developer.chrome.com/docs/devtools/overview
- **UX4:** Linear filters and URL-backed issue views — https://linear.app/docs/filters
- **UX5:** Octicons React/SVG integration and accessibility — https://primer.style/octicons/code/
- **UX6:** Octicons design guidelines — https://primer.style/octicons/design-guidelines/
- **UX7:** Octicons repository and license notes — https://github.com/primer/octicons
- **UX8:** Nielsen's usability heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- **UX9:** WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- **UX10:** WCAG 2.2 target size minimum — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

A reference does not claim exclusive originality or endorsement.
