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
// The Oddhound mark: a hound's head in profile with a long drop ear, built from a
// few circles and a hull (see public/brand/PROVENANCE.md). One colour, always.
export const HOUND_PATH = 'M20.1 7.7 19.4 7.6 18.5 7.5 17.8 7.5 17.1 7.5 16.4 7.6 15.5 7.8 14.6 8.1 13.9 8.4 13.3 8.7 12.5 9.2 12 9.7 11.3 10.3 10.8 10.8 10.4 11.3 10 11.9 9.5 12.7 9.1 13.8 8.7 14.9 8.6 16.1 8.5 16.8 8.5 17.5 8.6 18.6 8.9 19.8 9.3 20.9 9.8 21.8 10.3 27 16.7 10.5 16.9 10.1 17.1 9.7 17.5 9.2 18 8.8 18.5 8.4 19 8.2 19.6 8 20.2 7.9 20.8 7.9ZM20.3 9.6 20 9.7 19.6 9.8 19.1 10 18.9 10.2 18.6 10.5 18.4 10.8 18.3 11 11.7 28.1 11.5 28.6 11.4 29.3 11.3 29.9 11.3 30.5 11.4 31.1 11.5 31.6 11.6 32.2 11.9 32.7 12.1 33.2 12.5 33.7 12.8 34.2 13.2 34.6 13.7 34.9 14.2 35.3 14.7 35.5 15.2 35.8 15.8 35.9 16.3 36 16.9 36.1 17.5 36.1 18.1 36 18.6 35.9 19.2 35.8 19.7 35.5 20.2 35.3 20.7 34.9 21.2 34.6 21.6 34.2 21.9 33.7 22.3 33.2 22.5 32.7 22.8 32.2 22.9 31.6 23 31.1 23.1 30.2 22.9 11.7 22.8 11.2 22.6 10.9 22.4 10.5 22 10.1 21.6 9.9 21.2 9.7 20.7 9.6ZM26.8 13.4 26.3 12.3 25.9 11.7 25.5 11.2 25 10.6 24.6 10.1 23.6 9.3 24.1 10 24.4 10.6 24.5 11.3 24.6 12 24.8 30.4 24.7 31.3 24.5 32.2 24.3 33 23.9 33.8 23.4 34.6 22.8 35.3 22 36.1 21.3 36.6 20.4 37.1 19.6 37.4 18.7 37.7 17.7 37.8 16.7 37.8 15.7 37.7 14.8 37.4 14 37.1 13.1 36.6 12.4 36.1 11.7 35.4 11.1 34.7 11.8 41.5 24.4 41.5 26.1 30.9 32.1 35.4 32.6 35.7 33.1 35.9 33.6 36 34.2 36 34.6 36 35 35.9 35.4 35.7 35.8 35.5 42.2 31.5 42.5 31.3 42.9 30.9 43.2 30.5 43.5 30.1 43.7 29.6 43.9 29 43.9 28.4 43.9 27.9 43.7 27.2 43.5 26.7 43.2 26.3 42.8 25.8 42.4 25.4 28.5 15.3 27.8 14.8 27.2 14.5ZM28.6 17.6 28.6 17.9 28.5 18.2 28.3 18.5 28.1 18.8 27.9 18.9 27.6 19.1 27.3 19.2 27 19.2 26.6 19.2 26.4 19.1 26.1 18.9 25.8 18.7 25.6 18.5 25.5 18.2 25.4 17.9 25.4 17.6 25.4 17.2 25.5 16.9 25.7 16.7 25.9 16.4 26.1 16.2 26.4 16.1 26.7 16 27 16 27.4 16 27.6 16.1 27.9 16.3 28.2 16.5 28.4 16.7 28.5 17 28.6 17.3Z';
export const HOUND_VIEWBOX = '8.2 6.5 36 36';

/**
 * One-colour hound mark. It takes the surrounding text colour, so it is ink on
 * light surfaces and white on dark ones. `tile` puts it on the accent square
 * used for the app icon. Decorative unless `title` is given.
 */
export function HoundMark({ size = 24, title, tile = false }: { size?: number; title?: string; tile?: boolean }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  if (tile) {
    return (
      <svg className="hound-mark hound-tile" width={size} height={size} viewBox="0 0 48 48" focusable="false" {...a11y} style={{ flex: 'none', display: 'block' }}>
        <rect width="48" height="48" rx="11" fill="var(--accent)" />
        <svg x="7" y="7" width="34" height="34" viewBox={HOUND_VIEWBOX}><path d={HOUND_PATH} fill="var(--accent-contrast)" fillRule="evenodd" /></svg>
      </svg>
    );
  }
  return (
    <svg className="hound-mark" width={size} height={size} viewBox={HOUND_VIEWBOX} focusable="false" {...a11y} style={{ flex: 'none', display: 'block' }}>
      <path d={HOUND_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
