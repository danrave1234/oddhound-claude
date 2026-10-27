# Oddhound — three-minute HyperFrames demo production

**Revision:** 1.4 · **Date:** October 27, 2026  
**Owner:** Drave · **Deliverable:** an AI-assisted, evidence-backed submission video, not a generated simulation of product behavior.

**Update 4 — planning only:** use the product's proof milestones, not the former internal calendar. Record genuine registration/login and permitted state-changing exploration; observation-only footage cannot stand in for active testing. No renderer, video project, media or model is run by this update.

## 1. Locked production direction

Use **HeyGen's open-source HyperFrames** to assemble real Oddhound recordings, original graphics, narration and captions into the submission film. Official repository: `heygen-com/hyperframes`; official documentation: `hyperframes.heygen.com`. Source references H1–H7 are in the [research register](Oddhound-Research-Sources-v1.4.md). **This document owns the storyboard;** MVP plan §21 links here instead of repeating it.

HyperFrames belongs in a separate `demo-video/` project with its own dependencies and asset folder. Do not install its rendering engine, Puppeteer, FFmpeg, authoring MCP or creative plugins inside Oddhound's testing workers. Oddhound still uses Playwright alone for product browser control. Separate video tooling is not a second controller of a live test session.

**Output target (our choice):** 1920×1080, 16:9, 30 fps, H.264 MP4 with compatible audio, approximately 178 seconds and never above 180 seconds after encoding. The participant guide asks for a three-minute demo; the two-second margin is a delivery precaution, not an extra official rule. Preserve a captioned final cut and a caption file. [G1]

**Appearance:** retain Apple/macOS-inspired Oddhound styling. Use the actual app's translucent navigation, compact toolbar, segmented controls and evidence inspector. No Lucide, generic AI glows, unrelated dashboard reskins, invented OS window actions or unreadable glass over logs. Curated Octicons/original Oddhound assets remain the approved sources.

## 2. Evidence rules

The guide requires demonstrable work created during the event and clear original contributions. [G1]

1. Record the built application operating against authorized synthetic fixtures. Keep original recordings and run/evidence IDs.
2. AI may write the script, compose scenes, create original brand motion, generate a licensed/non-impersonating voice, make captions and edit footage.
3. AI must not invent bug counts, successful security tests, sponsor usage, metrics, model calls, replay outcomes or source-code fixes.
4. Do not use an AI reconstruction of the dashboard as proof of execution. Reconstructed explanatory scenes must be clearly marked as illustrations and not replace real finding evidence.
5. Label prerecorded runs, fast-forwarding, cuts and replay segments when relevant. Do not label a recording “live.”
6. Show an external coding assistant fixing the problem only if captured. Otherwise say the fix was applied separately and show the real before/after build and unchanged test.
7. Never render live API calls during the final video export. Freeze media and approved result data first.
8. Use synthetic credentials/data; scrub dashboard URLs, source code, terminal history, notifications and provider account screens. Don't assume blurring one password field sanitizes the entire clip.

## 3. Production files

```text
demo-video/
  package.json
  package-lock.json              # npm, matching the bootstrap below; separate from the app's pnpm workspace
  index.html                     # HyperFrames composition, authored by the video agent
  frame.md                       # Oddhound visual rules for video
  brief.md
  storyboard.md
  narration.md
  claims.json                    # only claims validated against actual evidence
  assets-manifest.json            # recording/voice/music/image provenance
  assets/
    footage/                     # sanitized local clips
    brand/                       # original Oddhound mark/SVGs
    audio/                       # approved narration and optional licensed music
    captions/                    # corrected timed captions
  snapshots/
  renders/
  QC.md
```

Keep raw private captures outside the public repo. Public source can reference sanitized redistributable clips or describe how to recreate them. Store large finished videos using an appropriate sharing/release destination rather than bloating the main application history. Verify that the submission link works signed out.

Each asset manifest entry should identify: file path, hash, source type, capture time, source run/build IDs, rights/permission, redaction review and clip duration. `claims.json` maps each claim to a run, scenario, screenshot/clip and human verification. No generated placeholders in the final claims file.

## 4. Storyboard: 178 seconds

| Time | Scene | Required footage/evidence | Narration purpose |
|---|---|---|---|
| 0:00–0:15 | Problem and identity | Original Oddhound title; short genuine app preview | Apps can be shipped before unexpected user behavior is tested. State our purpose, not an unsupported market statistic. |
| 0:15–0:35 | Configure the run | Real setup: authorized URL, goals, synthetic accounts and selected test mode | Explain the small amount of context the developer provides. |
| 0:35–1:10 | Discover and test | Real map and signup/login/state-changing browser actions, with selected moments enlarged | Show autonomous workflow discovery and a meaningful unexpected action inside the run-level grant. No prewritten ground-truth click script. |
| 1:10–1:45 | Evidence | One verified finding; one mobile result or controlled authorization finding if implemented | Show rule, observed outcome and reproduction. Explain what is verified and what remains untested. |
| 1:45–2:20 | Fix handoff | Actual Copy fix prompt interaction and external fix/build change | Emphasize that the developer can use their preferred coding AI; label time compression. |
| 2:20–2:40 | Retest | Real saved scenario on corrected build, original assertion unchanged | Demonstrate the closed loop, including a valid neighboring case when available. |
| 2:40–2:58 | Original contribution and scope | Real provider/model metadata, measured evaluation and repo/demo destination | State what we built, which sponsor services actually ran, and the bounded supported scope. |

Do not cram every test category into the video. One conclusive failure-to-fix sequence is the centerpiece. Use actual security footage only if the gated test is implemented and independently checked. Approximately two minutes should be product/evidence footage rather than decorative intro scenes.

## 5. AI-assisted workflow

### A. Establish the renderer early

Use a separate folder. HyperFrames needs Node.js 22+, FFmpeg/FFprobe and Chrome (`npx hyperframes browser ensure` finds or downloads Chrome). The app's Node 26 LTS line meets the minimum. Desktop Studio is optional and has no Windows build yet. [H1, H3, H6, T5]

**Windows (Drave's machine), from the v1.4 recheck** [H8, H9]:

- Render natively from PowerShell in a normal `C:\` folder. WSL2 can fall back to software rendering, which is several times slower.
- Install the 64-bit FFmpeg build from ffmpeg.org and put its `bin` folder on PATH; `doctor --json` must report it.
- Open issue #4845: Windows 11 Smart App Control can block `sharp`'s unsigned DLL, which breaks `check --snapshots`. If that happens, run `check` without `--snapshots` and inspect frames in `preview` instead. Do not disable Smart App Control just for this.
- Open issues #4058 (ffmpeg EBUSY) and #4060 (false disk-space check) can fail a render. Retry once, then use `render --docker`, or the fallback cut in step E.
- Avoid two `<video>` elements playing at the same time in Docker renders (#5473).

A bootstrap for the local video workspace:

```bash
mkdir -p demo-video
cd demo-video
npm init -y
npm install --save-dev --save-exact hyperframes
npx hyperframes skills update
npx hyperframes doctor --json
```

Every command and flag above, and in step E, was checked against the CLI docs on October 27 (`hyperframes` 0.8.x on npm). The CLI is pre-1.0 and releases often, so `--save-exact` matters. [H3] This resolves a published CLI when bootstrapping, then pins the installed version. Record the installed skill revision as well. Review skills/plugins before granting access to files or paid services. Run setup once; do not refresh everything automatically during final export.

**Important:** the documented `doctor --json` command can exit successfully even if its health payload reports problems. Inspect and gate on the JSON `ok` field, not the process exit code alone. Review dependencies/disk/cache issues before exporting. [H3]

Have the video coding agent read the installed HyperFrames skill and create a small genuine-media test composition before building the full film. Do not guess an outdated composition schema from memory.

### B. Record the product as it becomes ready

Record one usable slice each time it works: setup, discovery, negative-input evidence, mobile inspection, copy action and retest. Capture enough time before/after actions to preserve causality. Avoid showing secrets, customer accounts and private notifications.

Playwright recordings of the target browser are not the same as recordings of Oddhound's dashboard. Capture the actual dashboard too, so the map/inspector and test evidence are visible. Store source run IDs and clip timestamps together.

### C. Author with AI

Supply the handoff prompt below, the frozen footage manifest, the current UI standard, the storyboard and the verified claims. Ask for scene-level changes rather than a wholesale new visual direction.

Use seekable animation and locally available assets. Keep unseeded randomness, wall-clock timers, live requests and asynchronous state out of final composition timing. Motion in the app can remain implemented with Motion for React; the film uses HyperFrames-compatible timelines/adapters independently. [H4]

### D. Narration and captions

Draft approximately 320–380 spoken words, then adapt to the actual audio pace. This range is a production target, not a claim about a specific TTS provider. Explain the observed problem and user outcome; leave seconds for reading the evidence.

HyperFrames has built-in local `tts` (Kokoro, no API key) and `transcribe` (whisper-cpp/Parakeet, writes `.srt`/`.vtt`). The first run downloads a large model (Parakeet is about 640 MB), so run it early. [H3] Drave can record narration or use a clearly permitted synthetic voice. Do not clone a real person's voice without permission. Optional TTS/music/hosted-generation costs are separate from local HyperFrames rendering and from hackathon sponsor credits unless the provider explicitly confirms coverage. [H2]

Review product names, identifiers, captions, pauses, audio sync and volume manually. Do not rely on an automated transcript to get technical terms right. Mark narration as AI-generated in production notes when applicable; keep rights/provenance records.

### E. Check and render

After the agent has created the valid composition in the video project, use the pinned local CLI. Check flags against that installed version:

```bash
npx hyperframes lint .
npx hyperframes check . --snapshots
npx hyperframes preview
npx hyperframes render --output renders/oddhound-demo.mp4 --fps 30 --quality high
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json renders/oddhound-demo.mp4
```

Fix validation errors. Review snapshots around every scene transition as well as normal frames; a successful lint does not prove factual or visual correctness. Verify actual encoded duration, dimensions, audio, no black gaps, no clipping, readable evidence, and no secrets. Watch the final MP4 beginning to end with sound. [H3, H5]

Export screen recordings as H.264 MP4; unsupported codecs can appear black in preview. [H8] Render locally first. `render --docker` pins the renderer environment but still needs asset/font/codec validation. [H4] Optional hosted rendering has a separate budget. Maintain a rough fallback cut from genuine clips once the core workflow/evidence loop exists. If HyperFrames cannot produce a verified final render at R7, use the checked plain-editor cut. Do not fabricate footage to meet a date.

## 6. Paste-ready prompt for the video agent

> Create Oddhound's hackathon demo using the installed official HyperFrames skill. This is a product demonstration, not a speculative commercial.
>
> Read brief.md, storyboard.md, frame.md, claims.json and assets-manifest.json first. Produce a 1920×1080, 30 fps MP4 targeting 178 seconds, with readable captions and no duration above 180 seconds. Use the actual recordings for product behavior. Never regenerate or invent a finding, interface state, model action, security result, metric or successful retest. Unavailable footage must be reported as a missing asset; do not fabricate a substitute.
>
> Follow the seven-scene storyboard. Keep the Apple/macOS-inspired Oddhound appearance: restrained translucent shell, clear evidence surfaces, compact controls, original hound identity and calm purposeful motion. Do not use Lucide or change the application into a different dashboard design. Reuse approved icons/assets only. Intro and explanatory overlays may be original animation, but recorded application evidence must remain truthful.
>
> Show the real discovery → unexpected action → evidence → copied fix brief → external correction → unchanged retest sequence. Clearly label prerecorded footage and time-compressed steps when needed. Display provider names only when backed by the recorded run. Do not imply all sponsors were used if they were only planned.
>
> Freeze all footage, audio, fonts and data locally before rendering; no live inference or website access at render time. Use the framework's seekable animation contract. Keep narration and captions synchronized and leave time to read the evidence. Run lint and check, inspect representative frames and transitions, render the MP4, then check actual duration and playback. Report missing evidence, failed checks, costs requiring approval and limitations. Do not mark the work final solely because rendering succeeded.

## 7. Milestones and done criteria

- After implementation is explicitly started: validate a short permitted non-product render and record dependencies; this does not prove the product exists.
- As R3–R5 produce genuine behavior: capture clips and update the asset/claims ledger.
- After the active failure/fix/unchanged-retest loop works: assemble the narrative and fallback rough cut.
- At R6/R7: use real-site footage, check claims/redaction, render and review the complete film, then verify signed-out links and actual encoded duration.
- Keep any official submission cutoff separate from engineering proof; do not invent successful footage or weaken a gate to satisfy an internal date.

Done means: evidence-backed claims, real product footage, correct original-contribution disclosure, readable actual results, permitted media, no secrets, encoded duration checked, and an accessible submission URL. The video project is planned here; no video has been rendered by this document update.
