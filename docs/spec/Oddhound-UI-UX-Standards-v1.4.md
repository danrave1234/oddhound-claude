# Oddhound — UI/UX implementation standards

**Revision:** 1.4 · **Date:** October 27, 2026

**This is the canonical frontend specification.** MVP plan §15 only summarizes it and links here; on any conflict, this document wins. Status names come from the canonical vocabulary in [MVP plan §10](Oddhound-MVP-Build-Plan-v1.4.md#status-vocabulary-canonical). **Apple/macOS-inspired design stays. No Lucide.** This document specifies the design; it does not implement or redesign the existing prototype.

## Design requirement

**Design requirement from Drave:** keep the Apple/macOS-inspired visual direction. Do not use Lucide React. The request to avoid generic AI-generated UI was not permission to replace the macOS aesthetic. Combine that aesthetic with familiar testing, debugging, and issue-review interactions, plus original Oddhound branding.

**Design principle:** macOS-inspired appearance, familiar controls, original Oddhound identity. The user should not have to learn a new metaphor to start a run, inspect a failure, copy a fix brief, or retest. Usability standards support the selected visual direction; they do not replace it. This remains a proposed design, not a claim of completed usability validation.

The UI retains the original Apple/macOS-inspired brief restored in v1.2. Later revisions changed provider, sandbox, security and video planning elsewhere; none of that changes the selected visual identity. Use Finder, Safari, and Xcode as visual references for the proposed workspace: translucent sidebar treatment, a compact toolbar, segmented controls, resizable split panes, and a contextual inspector. Recreate this direction with web components and original assets; keep browser evidence and text on readable surfaces. Do not add fake OS controls that imply actions the website cannot perform.

## 1. macOS visual direction and supporting interaction references

The Apple/macOS-inspired direction is the primary visual brief. The references below inform specific testing interactions only; they must not turn Oddhound into a GitHub-, Linear-, or DevTools-themed application. Preserve original Oddhound branding. The interaction references were reviewed through documentation during revision 1.1, not a hands-on audit of signed-in accounts; later revisions do not claim a new reference audit.

| Reference | Documented pattern | Oddhound adaptation |
|---|---|---|
| Playwright Trace Viewer | Action list, timeline, before/after snapshots, console/network details. [UX1] | Select a recorded test step and inspect the corresponding evidence. Put the observed action before the AI explanation. |
| GitHub Actions | Run progress graph, status per job, click-through into logs. [UX2] | Discoveries and testing states update live; selecting a workflow reveals its checks. Keep execution status separate from finding count. |
| Chrome DevTools | Named inspection panels and device-mode controls. [UX3] | Use familiar Browser, Network, and Console tabs, explicit viewport/session labels, and resizable inspection panes. |
| Linear | Filterable issue lists with shareable filtered views. [UX4] | Provide a findings table with status, severity, workflow, and device filters; preserve selection and list position when inspecting a finding. |

Keep visual and interaction references separate on the reference board: macOS-inspired appearance first, then the particular testing interaction and why it helps. Do not blend unrelated product themes or let an icon package determine the application theme.

## 2. Information architecture and workspace behavior

Primary navigation: **Projects, Runs, Workflows, Findings, Reports**; Settings remains secondary. Use ordinary developer vocabulary. The hound identity belongs in branding, not substitute navigation names such as “Kennels” or “Sniff trails.”

Primary routes: projects, project setup/scope review, run workspace, finding detail, report/retest. Billing, team administration, advanced integration settings, and elaborate onboarding remain outside the MVP.

On wide screens:

- **Left navigation:** project and run context, main destinations, selected section.
- **Center workspace:** Workflows (Map/List), Browser, or Findings. The graph remains a first-class live-discovery view, but is not forced onto every task.
- **Right inspector:** selected workflow, scenario, or finding, with an evidence-first summary and deeper details available through tabs/disclosure.
- **Run toolbar:** project/run, target environment, execution state, elapsed time, and Stop run while active. Retest and Copy fix prompt appear where relevant rather than making every toolbar contain every action.

Open an active run on the workflow view by default. Show a compact last-action summary and a clear entry to the browser session. Opening a completed run should prioritize its results and coverage limits; never switch an already-open workspace away from the user's selection when completion occurs. Remember the user's chosen view, pane widths, and graph position.

Graph behavior:

- Offer **Map** and **List** views over the same persisted records.
- Display execution status, check results, and verified issue count separately.
- Keep observed transitions visually distinct from proposed, untested actions.
- Keep existing positions stable as new nodes arrive. A **Follow agent** control explicitly opts into tracking the current activity; user navigation disables following until re-enabled.
- Batch background changes. Do not jump the viewport, steal focus, or reorder a selected result because another event arrived.
- Give edges and nodes useful labels; provide equivalent workflow details in the list view.

Findings behavior:

- Start with a scan-friendly table: title, verification status, impact/severity, workflow, device, last observed run.
- Group findings as **Verified issues**, **Configuration observations**, **Needs review**, and **Suggestions** (the four finding categories). A design preference or missing header must not resemble a verified defect.
- Open a finding without losing filters or scroll position. Give every run/finding a stable internal URL; enforce authorization on every deep link.
- Put expected behavior, observed behavior, reproduction, evidence, and **Copy fix prompt** before raw technical logs.
- A copied prompt produces inline confirmation; clipboard failure has a selectable-text fallback.

On narrower screens, collapse the navigation and show the inspector as a dedicated route or accessible sheet. Mobile is primarily a monitoring/review surface; do not compress three desktop panes into an unusable strip. Preserve access to Stop run, findings, evidence, copy, and retest. The graph has a list alternative.

## 3. Icon policy — no Lucide

Remove `lucide-react` from the selected dependencies and prohibit Lucide imports in application code, shared components, examples copied into the app, and AI-generated additions. Audit any installed/copied component code rather than assuming its defaults match this requirement.

Use a small, curated selection of **GitHub Octicons** via `@primer/octicons-react` for universal controls: search, play/run, stop, copy, replay, external link, filter, chevrons, and status indicators. GitHub provides SVG icons and a React integration, with 16px and 24px design grids. [UX5, UX6]

Octicons is an icon source only, not a decision to adopt GitHub's Primer theme or change the macOS visual direction. Use only glyphs that fit the intended optical weight and scale; use original SVGs for gaps. Review the set together so the controls remain visually consistent. No Lucide, including icons silently introduced by copied components.

Use **original Oddhound SVGs** for the hound mark, favicon, and a small number of product-specific illustrations. Custom symbols supplement labels; do not invent an ambiguous replacement for Stop or Copy. Never use a sparkle as the universal symbol for unrelated AI features.

Implementation contract:

- Centralize all approved icons in `packages/ui/icons`; expose semantic names through one local `Icon` component.
- Use named/static imports. Do not ship a dynamic registry of every icon in the upstream package.
- Standard glyph sizes are 16px for dense rows and 24px for larger controls. The pointer target is larger than the visible glyph.
- Keep a consistent optical weight, alignment, and monochrome default. Status color is accompanied by a label and, where useful, a different shape.
- Prefer text plus icon for important actions. Icon-only buttons require an accessible name and a keyboard-accessible tooltip; a tooltip is not a substitute for the accessible name.
- Decorative icons next to sufficient text are not announced again to assistive technology.
- Preserve upstream license notices. Octicons' repository distinguishes its MIT-licensed files from use of GitHub logos; do not use GitHub brand marks as Oddhound branding. [UX7]

## 4. Usability rules expressed as product behavior

Nielsen's heuristics emphasize status visibility, familiar language, consistency, recognition, user control, error prevention, and recovery. The following are our concrete implementation choices applying those principles—not a claim of a completed usability evaluation. [UX8]

| Principle | Required Oddhound behavior |
|---|---|
| Familiarity and consistency | Stable navigation, conventional controls, consistent labels, selected-row behavior, and predictable panel placement. |
| Recognition over memory | Keep run, account role, device, current workflow, and assertion source visible in context. |
| Visibility of status | Show every run status distinctly: queued, provisioning, running, waiting for input, stopping, finalizing, completed, stopped, failed, blocked. Show the client connection state (live/reconnecting/stale) and a last-update timestamp separately from run status. |
| Honest progress | Use counts with a defined denominator, such as 8 of 12 planned checks. Do not fabricate a percentage of the unknown whole website. |
| User control | Stop remains available during execution. Explain that it prevents further work but cannot undo actions already completed. Do not add a nonfunctional Pause button. |
| Error prevention | Review target, permitted actions, environment, and budgets before a run; validate credentials/setup inline without exposing secrets. |
| Recovery | Preserve setup inputs, explain login/MFA blockers, allow a safe retry from a known state, and distinguish interrupted evidence from a completed test. |
| Progressive disclosure | Summary first; requests, response bodies, assertions, model/tool diagnostics, and raw trace references on demand. |
| Stable attention | Incoming events never steal focus or scroll the user away from evidence. Offer an explicit “new events” indicator. |
| Efficiency | Search/filter tables, deep-link findings, retain selection, and provide optional documented shortcuts without hijacking browser shortcuts. |

Keep the activity log factual: “Submitted the registration form” or “Checking the mobile menu.” Do not display fabricated thoughts, hidden chain-of-thought, or generic thinking prose as evidence. Explain the selected test's goal when useful, based on recorded inputs and outputs.

## 5. Accessibility and interaction acceptance criteria

Target WCAG 2.2 AA for applicable product screens and document remaining gaps. A component library or passing automated scan alone does not establish conformance. [UX9]

- Core setup, stop, finding inspection, copying, and retesting work by keyboard. Focus is visible and not hidden by sticky UI; dismissal restores focus to the trigger.
- Use semantic buttons, links, tables, headings, and appropriately implemented tab/dialog patterns. Custom canvas interactions have an equivalent list-based task path.
- Meet 4.5:1 contrast for ordinary text, 3:1 for qualifying large text, and 3:1 for required non-text component/state boundaries against adjacent colors, subject to the relevant criterion's exceptions. Never encode status through color alone. [UX9]
- Prefer at least 32×32 CSS-pixel click targets in dense desktop controls and 44×44 for primary touch controls. These are Oddhound design choices; WCAG 2.2 AA 2.5.8 specifies 24×24 or permitted spacing/exceptions, not a universal 44px minimum. [UX10]
- Respect reduced motion. Announce meaningful run/finding state changes through a throttled polite live region; do not announce every browser event.
- Support 200% text zoom and reflow of core screens. Where a graph needs two-dimensional space, preserve the accessible list and all primary actions.
- Test light and dark themes, empty/error/partial states, long URLs/titles, and disabled controls. “Passed,” “not run,” “blocked” and “inconclusive” must remain visibly and semantically distinct.

## 6. Visual language and motion — keep the Apple/macOS aesthetic

**Target:** an Apple/macOS-inspired developer application in the browser, with original Oddhound branding. This is not a replacement GitHub/Linear theme, an unstyled component-library dashboard, or an AI-chat-first interface.

- **Application shell:** a softly translucent sidebar, compact top toolbar, resizable center workspace, and right-hand inspector. Preserve the previously selected three-pane composition.
- **Controls:** rounded segmented controls for Map/List and Browser/Findings views, recognizable buttons, subtle selected states, fine separators, and coherent corner radii. Keep control placement stable.
- **Surfaces:** warm neutral light mode and graphite dark mode. Use restrained blur/translucency on navigation chrome, with opaque fallbacks; keep screenshots, logs, findings, and evidence on clear, high-contrast surfaces. Use subtle elevation rather than heavy drop shadows.
- **Typography:** use a local system-font stack such as `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; do not download or bundle Apple font files. Keep text readable and use monospace selectively for IDs, locators, durations, and request details. Use tabular numerals for changing counters.
- **Brand:** retain the Oddhound hound mark and one restrained brand accent. The macOS-inspired shell and original Oddhound identity should coexist; no third-party brand marks as our identity.
- **Icons:** use the approved non-Lucide icon layer described above. Match optical size, alignment, and weight to the macOS-inspired controls; the icon library must not dictate the overall visual language.

Avoid oversized statistic cards, saturated decorative gradients, glowing borders, or a centered chat box as the main workspace. These are not a substitute for the chosen macOS aesthetic. Do not display an artificial “AI quality score” without a meaningful definition. Glass effects are allowed in the shell, not as an excuse for unreadable evidence.

Use Motion for informative, polished transitions: a newly discovered workflow, an inspector opening, a segmented-view change, copy confirmation, or a verified finding arriving. Start with 120–180ms for routine transitions, honor reduced motion, and keep graph positions stable. Do not animate every node or perpetually pulse the workspace. [S22, S23]

shadcn/ui may remain as a source of selected behavior primitives, not the finished visual system. Restyle them to the macOS-inspired Oddhound tokens, remove any Lucide imports, and test the composed application. Do not add another full component framework just for appearance.

## 7. Frontend contracts and implementation structure

Keep these reusable modules in `packages/ui` (folders are sufficient initially):

| Module | Responsibility |
|---|---|
| `tokens/` | Semantic colors, spacing, density, typography, radii, focus, and motion. |
| `icons/` | Approved Octicons and original Oddhound SVGs, accessed through one contract. |
| `AppShell`, `RunToolbar` | macOS-inspired sidebar, compact toolbar, segmented navigation, project/run context, and primary run controls. |
| `WorkflowNavigator` | Map/list selection, stable placement, filters, follow-agent behavior. |
| `StatusBadge` | Shared execution/test/finding vocabulary and non-color cues. |
| `FindingTable`, `EvidenceInspector` | Triage and evidence review with persistent selection. |
| `AgentActivityLog` | Timestamped factual events, reconnect/stale states, bounded updates. |
| `IconButton` | Accessible names, target size, focus states, tooltip behavior. |

Use the same event/state contracts for graph, list, inspector, and reports. Client layout preferences are separate from authoritative run state. Do not introduce a second event interpretation in the UI.

Add restricted-import lint rules for Lucide and for direct upstream icon imports outside the approved icon module. Add UI smoke tests for keyboard setup, selecting a workflow from the list, opening a finding, copying its fix brief, and stopping a run. Do not write prototype data into real result views.

## 8. Design review and assets during the build window

Before styling each main screen, document its user task, information priority, macOS-inspired visual reference, and one relevant testing interaction. The visual direction is already selected: do not restart a redesign or replace it with a generic dashboard. Review ordinary, empty, loading, failure, partial-result, and long-content states.

Use Muse Image during the permitted build period to explore a distinctive hound mark and two illustration states, then create/review the usable SVG asset and implement motion in code. Do not imply image generation supplied an editable vector or working animation automatically. Record provenance; avoid third-party protected marks and unlicensed fonts.

Use the mascot in the landing page and empty states. Do not let “found” imagery imply that an unverified candidate is a confirmed defect. Earlier TraceLab mockups remain references until reuse eligibility is confirmed; their icon and styling choices are not mandatory.

Before feature freeze, conduct a small task-based review with available developers. Ask them to start a scoped run, identify the current workflow, distinguish a verified issue from a candidate, inspect evidence, copy a fix brief, and retest. Record completion, hesitations, wrong clicks, and needed assistance. Report the actual participant count; do not invent usability findings.

The design passes our MVP review when those tasks are understandable without a tour, the keyboard path works, status is truthful, and the interface does not distract from evidence. Formal usability validation remains broader than this small review.

## 9. Active-testing setup, security and provenance UI

Keep the selected macOS design. These are content/interaction additions, not a visual redesign.

- **Site verification is the first setup step** for real sites. Show the three methods with copyable values and **Check now**, then the verified state/reason. Include separate proof for any active first-party API origin. Ask **Staging or production?** next. Active testing is primary after a run-level grant; observation-only is optional. Production requires explicit write/test-account permission rather than silently becoming a crawler. Show remaining runs and budget availability. Never admit an unverified active scope.
- The landing page offers **Try the demo target** (no sign-in) and **Watch a demo replay** next to **Scan your site**, so a visitor understands the product in seconds without an account.
- Setup shows separate **Observed-traffic checks**, **User-workflow tests** and **Controlled security probes** with prerequisites. Security-probe permission is explicit; an account role or domain-verification badge does not authorize every action.
- Security setup requests two controlled accounts and known fixtures only when the chosen tests require them. Missing inputs show “Not tested — second test account required,” never a green pass.
- Show the selected provider **and Meta model** in run details, approved data-handling profile, sandbox/runtime state and meaningful blocked reasons. Keep technical configuration in disclosure panels, not a giant sponsor selector on every page.
- On provider failover, show a factual event and retained checkpoint. Never animate activity as if an uncertain submission completed.
- Separate verified issues, configuration observations, needs-review findings and visual suggestions. Include permission mode, actor, rule source and reproduction evidence in the inspector.
- Artifacts are private; share/export actions explain redaction and access. Raw trace links are not public video assets.
- A `Demo replay` label identifies prerecorded/sample activity. No fake Live badge, invented stats or model thinking.
- Group permissions by capability: registration/login, synthetic create/edit/cancel, mutation/repeat tests and separately opted-in probes. Show actors, test-data boundaries, forbidden effects and cleanup once; do not require each click or a route script. Separately verified API scope and unsupported SSO/email/socket prerequisites have clear explanations.
- **Try the demo target** remains sign-in-free, with truthful queue/budget availability. When live funding or safety gates prevent a run, show the reason and offer the labeled recorded replay; never spend judging funds based on a public request or present replay as a new run.

## 10. Video consistency

The HyperFrames film inherits the actual UI tokens, approved icon layer and original Oddhound identity through `demo-video/frame.md`. The film may magnify real evidence and add clearly editorial annotations; it must not redraw a non-working screen to pretend the feature exists. Use local system fonts for the application without distributing Apple font files, and separately licensed/available video fonts. Keep No Lucide enforceable in app code and in AI-generated video assets.


## References

UX1–UX10 and S22–S23 are listed in the [research register](Oddhound-Research-Sources-v1.4.md). The UX references were checked for revision 1.1 (October 26, 2026) and not re-audited since.

The adaptations and acceptance criteria are Oddhound design decisions. The original HTML prototype and any application repository were not modified by these documents.
