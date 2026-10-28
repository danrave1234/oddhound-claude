// The ONLY module allowed to import icon glyphs (enforced by tests/lint/no-lucide.ts).
// Curated GitHub Octicons for universal controls plus original Oddhound SVGs. No Lucide.
import {
  AlertIcon, ArrowLeftIcon, ArrowRightIcon, BrowserIcon, BugIcon, CheckCircleIcon, CheckIcon, ChevronRightIcon, ClockIcon, CopyIcon,
  DeviceDesktopIcon, DeviceMobileIcon, DotFillIcon, DownloadIcon, EyeIcon, FileIcon, FilterIcon, GearIcon, GlobeIcon, GraphIcon,
  HistoryIcon, InfoIcon, KeyIcon, LinkExternalIcon, ListUnorderedIcon, LockIcon, PersonIcon, PlayIcon, PlusIcon, ProjectIcon,
  PulseIcon, QuestionIcon, ShieldCheckIcon, SignInIcon, SignOutIcon, SkipIcon, SquareFillIcon, SyncIcon, WorkflowIcon, XCircleIcon,
} from '@primer/octicons-react';
import type { ComponentType, SVGProps } from 'react';

type GlyphProps = { size?: number; 'aria-label'?: string; 'aria-hidden'?: boolean };

/* ── Original Oddhound glyphs (16px grid, 1.5px strokes, currentColor) ─────────── */
function svgProps({ size = 16, ...rest }: GlyphProps): SVGProps<SVGSVGElement> {
  const labelled = Boolean(rest['aria-label']);
  return { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    role: labelled ? 'img' : undefined, 'aria-label': rest['aria-label'], 'aria-hidden': labelled ? undefined : true, focusable: false, style: { verticalAlign: 'text-bottom', flex: 'none' } };
}
/** Sniff: a nose and scent arcs. Used for "scan" (exploring a site). */
const SniffGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><circle cx="4" cy="8" r="2" fill="currentColor" stroke="none" /><path d="M8 5.2a4 4 0 0 1 0 5.6" /><path d="M10.6 3a7 7 0 0 1 0 10" /></svg>
);
/** Paw print: the hound's trail. Used for exploration progress. */
const PawGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)} stroke="none" fill="currentColor">
    <ellipse cx="3.6" cy="7.2" rx="1.35" ry="1.7" /><ellipse cx="6.4" cy="4.4" rx="1.35" ry="1.75" /><ellipse cx="9.6" cy="4.4" rx="1.35" ry="1.75" /><ellipse cx="12.4" cy="7.2" rx="1.35" ry="1.7" />
    <path d="M8 7.6c1.9 0 3.6 2.2 3.6 3.9 0 1.3-.9 1.9-1.9 1.9-.7 0-1.1-.3-1.7-.3s-1 .3-1.7.3c-1 0-1.9-.6-1.9-1.9 0-1.7 1.7-3.9 3.6-3.9z" />
  </svg>
);
/** Trail: a dotted route ending at a target. Used for workflows the agent discovered. */
const TrailGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><circle cx="3" cy="12.5" r="1.4" /><path d="M4.4 11.6c2-1.3 1.3-3.6 3.6-4.6 1.7-.7 2.7.3 4.1-.9" strokeDasharray="1.6 2" /><circle cx="13" cy="4" r="1.8" fill="currentColor" stroke="none" /></svg>
);
/** Replay: two passes of the same check. Used for independent verification. */
const ReplayGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.7" /><path d="M12.6 1.9v2.7H9.9" /><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.7" /><path d="M3.4 14.1v-2.7h2.7" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></svg>
);
/** Pointer: you control the live browser. Used for the sign-in handoff. */
const PointerGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><path d="M3.2 2.4l9.4 4.2-4 1.3-1.4 4.1z" fill="currentColor" fillOpacity=".18" /><path d="M8.6 7.9l3.6 3.6" /></svg>
);
/** Evidence: a captured frame with a pin. Used for screenshots attached to findings. */
const EvidenceGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><rect x="1.8" y="3" width="12.4" height="10" rx="2" /><path d="M1.8 10.6l3.4-3 2.6 2.3 2-1.6 4.4 3.4" /><circle cx="10.8" cy="6.2" r="1.1" fill="currentColor" stroke="none" /></svg>
);
/** Pause: two bars (replay playback). */
const PauseGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)} stroke="none" fill="currentColor"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" /><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" /></svg>
);
/** Fix prompt: a note handed to your coding AI. */
const BriefGlyph = (p: GlyphProps) => (
  <svg {...svgProps(p)}><path d="M4 1.8h5.3L12.5 5v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" /><path d="M9 1.8V5.3h3.5" /><path d="M5.6 8.4h4.8M5.6 11h3.2" /></svg>
);

const glyphs = {
  alert: AlertIcon, back: ArrowLeftIcon, arrow: ArrowRightIcon, browser: BrowserIcon, bug: BugIcon, check: CheckCircleIcon, tick: CheckIcon,
  chevron: ChevronRightIcon, clock: ClockIcon, copy: CopyIcon, desktop: DeviceDesktopIcon, mobile: DeviceMobileIcon, dot: DotFillIcon,
  download: DownloadIcon, eye: EyeIcon, report: FileIcon, filter: FilterIcon, settings: GearIcon, globe: GlobeIcon, map: GraphIcon,
  runs: HistoryIcon, info: InfoIcon, key: KeyIcon, external: LinkExternalIcon, list: ListUnorderedIcon, lock: LockIcon, person: PersonIcon,
  play: PlayIcon, plus: PlusIcon, project: ProjectIcon, pulse: PulseIcon, question: QuestionIcon, shield: ShieldCheckIcon, signin: SignInIcon,
  signout: SignOutIcon, skip: SkipIcon, stop: SquareFillIcon, retest: SyncIcon, workflow: WorkflowIcon, fail: XCircleIcon,
  // original Oddhound glyphs
  sniff: SniffGlyph, paw: PawGlyph, trail: TrailGlyph, replay: ReplayGlyph, pointer: PointerGlyph, evidence: EvidenceGlyph, brief: BriefGlyph, pause: PauseGlyph,
} satisfies Record<string, ComponentType<GlyphProps>>;

export type IconName = keyof typeof glyphs;

/** Decorative by default (hidden from assistive tech). Pass `label` when the icon stands alone. */
export function Icon({ name, size = 16, label }: { name: IconName; size?: 16 | 24; label?: string }) {
  const Glyph = glyphs[name] as ComponentType<GlyphProps>;
  return label ? <Glyph size={size} aria-label={label} /> : <Glyph size={size} aria-hidden />;
}

/* ── Brand ───────────────────────────────────────────────────────────────────── */
// Brand colours are fixed (not themed) so the mark reads the same everywhere.
// Field palette: forest tile, cream hound with a brown ear, blaze-orange collar and scent.
const FOREST = '#1e3b30', EAR = '#8a5a3c', CREAM = '#fbf7ef', INK = '#15171c', BLAZE = '#f2541b';

/** Hound head in profile, facing right, with a long ear and scent arcs. Drawn on a 32px grid. */
function HoundHead({ ear = EAR, face = CREAM, ink = INK, arcs = BLAZE, collar = BLAZE, line }: { ear?: string; face?: string; ink?: string; arcs?: string; collar?: string; line?: string }) {
  return (
    <g className="hound-head">
      <path d="M9.4 8.6C10.9 6.7 13.5 6 15.9 6.5c2 .4 3.4 1.8 4.5 3.4l4.9 2.5c1.4.8 1.8 2.5.9 3.8-.6.8-1.6 1.1-2.6.9l-3-.4c-.6 1.8-1.6 3.6-2.7 4.8l-1.2 4H10.4c.4-2.8 0-5.2-1.2-7.2-1.3-2.3-1.4-7.2.2-9.7z" fill={face} />
      <path className="hound-ear" d="M11.3 8.4c-1.9 1-2.9 3.9-2.5 7.3.3 2.6 1.4 4.8 2.8 5.2 1.1.3 1.8-.7 1.9-2.1.2-3.3.1-7.1-.6-9.3-.3-1-1-1.4-1.6-1.1z" fill={ear} />
      <circle cx="17.4" cy="11" r="1.05" fill={ink} />
      <circle cx="25.5" cy="14.1" r="1.2" fill={ink} />
      <path d="M10.6 22.4h6.5l-.4 1.7h-6.1z" fill={collar} />
      <g className="hound-arcs" stroke={arcs} strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M28.1 12.4a2.6 2.6 0 0 1 0 3.6" opacity=".9" />
        <path d="M30 10.9a4.8 4.8 0 0 1 0 6.6" opacity=".55" />
      </g>
    </g>
  );
}

/** Oddhound app mark (AI-generated with Recraft V4.1, see public/brand/PROVENANCE.md). Decorative by default. */
export function HoundMark({ size = 24, title }: { size?: number; title?: string }) {
  const px = size <= 32 ? 64 : size <= 64 ? 128 : 256;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="hound-mark" src={`/brand/oddhound-icon-${px}.png`} srcSet={`/brand/oddhound-icon-${px}.png 1x, /brand/oddhound-icon-${Math.min(px * 2, 512)}.png 2x`}
      width={size} height={size} alt={title ?? ''} style={{ flex: 'none', display: 'block' }} />
  );
}

const ART = {
  tracking: { src: '/brand/hound-tracking.png', w: 1600, h: 769 },
  found: { src: '/brand/hound-found.png', w: 720, h: 753 },
} as const;

/** Mascot illustrations: the hound tracking a scent across web pages, and the hound pointing at a flagged problem. */
export function HoundArt({ name, width, className }: { name: keyof typeof ART; width: number; className?: string }) {
  const a = ART[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={a.src} width={width} height={Math.round((width * a.h) / a.w)} alt="" loading="lazy" decoding="async" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
  );
}

/** Larger mascot for the landing page and empty states (decorative). */
export function HoundFigure({ size = 72 }: { size?: number }) {
  return (
    <svg className="hound-figure" width={size} height={size} viewBox="4 3 30 26" aria-hidden focusable="false" style={{ flex: 'none' }}>
      <HoundHead face="var(--hound-face)" ear="var(--hound-ear)" ink="var(--hound-ink)" arcs="var(--blaze)" collar="var(--blaze)" line="var(--hound-line)" />
    </svg>
  );
}
