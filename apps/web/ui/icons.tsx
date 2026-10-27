// The ONLY module allowed to import icon glyphs (enforced by tests/lint/no-lucide.ts).
// Curated GitHub Octicons for universal controls plus original Oddhound SVGs. No Lucide.
import {
  AlertIcon, BugIcon, CheckCircleIcon, ChevronRightIcon, CopyIcon, DeviceDesktopIcon, DeviceMobileIcon, DotFillIcon,
  EyeIcon, FileIcon, FilterIcon, GearIcon, GlobeIcon, HistoryIcon, LinkExternalIcon, PlayIcon, ProjectIcon,
  QuestionIcon, ShieldCheckIcon, SignOutIcon, SkipIcon, SquareFillIcon, SyncIcon, WorkflowIcon, XCircleIcon, DownloadIcon,
} from '@primer/octicons-react';
import type { ComponentType } from 'react';

const glyphs = {
  alert: AlertIcon, bug: BugIcon, check: CheckCircleIcon, chevron: ChevronRightIcon, copy: CopyIcon, desktop: DeviceDesktopIcon,
  mobile: DeviceMobileIcon, dot: DotFillIcon, eye: EyeIcon, report: FileIcon, filter: FilterIcon, settings: GearIcon, globe: GlobeIcon,
  runs: HistoryIcon, external: LinkExternalIcon, play: PlayIcon, project: ProjectIcon, question: QuestionIcon, shield: ShieldCheckIcon,
  signout: SignOutIcon, skip: SkipIcon, stop: SquareFillIcon, retest: SyncIcon, workflow: WorkflowIcon, fail: XCircleIcon, download: DownloadIcon,
} satisfies Record<string, ComponentType<{ size?: number; 'aria-label'?: string; 'aria-hidden'?: boolean }>>;

export type IconName = keyof typeof glyphs;

/** Decorative by default (hidden from assistive tech). Pass `label` when the icon stands alone. */
export function Icon({ name, size = 16, label }: { name: IconName; size?: 16 | 24; label?: string }) {
  const Glyph = glyphs[name];
  return label ? <Glyph size={size} aria-label={label} /> : <Glyph size={size} aria-hidden />;
}

/** Original Oddhound hound mark. */
export function HoundMark({ size = 24, title = 'Oddhound' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 10.5c0-2 1.6-3.5 3.6-3.5h3.2c2.6 0 4.6 1.4 5.6 3.6l1 2.2h2.1c1.4 0 2.5 1.1 2.5 2.5 0 1.6-1.3 2.9-2.9 2.9h-2.4l-2.1 5.6c-.4 1-1.3 1.7-2.4 1.7h-2.6c-1.4 0-2.4-1.1-2.4-2.4V18l-2.3-2.4C9.4 15 9 14.1 9 13.2z"
        fill="var(--accent-contrast)" />
      <circle cx="17.6" cy="12.6" r="1.2" fill="var(--accent)" />
      <path d="M11.2 9.2c-.9 1.6-1 3.6-.2 5.3" stroke="var(--accent)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
