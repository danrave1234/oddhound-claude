import Link from 'next/link';
import { HoundMark, Icon, type IconName } from './icons';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/app', label: 'Projects', icon: 'project' },
  { href: '/app/runs', label: 'Runs', icon: 'runs' },
  { href: '/app/findings', label: 'Findings', icon: 'bug' },
  { href: '/app/reports', label: 'Reports', icon: 'report' },
];

const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function Shell({ active, user, children, toolbar }: { active: string; user: { name: string; email: string } | null; children: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Link href="/" className="brand" aria-label="Oddhound home"><HoundMark size={26} /><span className="brand-text">Oddhound</span></Link>
        <div className="nav-label" aria-hidden>Workspace</div>
        <div className="sidebar-nav">
          {NAV.map((n) => (
            <Link key={n.href} className="nav" href={n.href} aria-current={active === n.href ? 'page' : undefined}><Icon name={n.icon} /> {n.label}</Link>
          ))}
        </div>
        <div className="sidebar-foot">
          <Link className="sidebar-link" href="/status"><Icon name="pulse" /> Service status</Link>
          <div className="user-card" title={user ? `${user.name} · ${user.email}` : 'Viewing as a guest'}>
            <span className={`avatar${user ? '' : ' avatar-guest'}`} aria-hidden>{user ? initials(user.name || user.email) : <Icon name="person" />}</span>
            <span className="who">
              {user ? <><strong className="truncate">{user.name}</strong><span className="muted truncate">{user.email}</span></> : <strong>Guest</strong>}
            </span>
          </div>
        </div>
      </nav>
      <div style={{ minWidth: 0 }}>
        <div className="toolbar">{toolbar}</div>
        <main className="content fade-in">{children}</main>
      </div>
    </div>
  );
}

/** Honest quota meter: used vs. allowed runs today, with the text alongside. */
export function RunsLeft({ left, total }: { left: number; total: number }) {
  return (
    <span className="pill-stat tabular" title="Runs left today (resets at 00:00 UTC)">
      <span className="meter" aria-hidden>{Array.from({ length: total }, (_, i) => <i key={i} className={i < left ? 'on' : ''} />)}</span>
      {left} of {total} runs left today
    </span>
  );
}
