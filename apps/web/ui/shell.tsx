import Link from 'next/link';
import { HoundMark, Icon, type IconName } from './icons';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/app', label: 'Projects', icon: 'project' },
  { href: '/app/runs', label: 'Runs', icon: 'runs' },
  { href: '/app/findings', label: 'Findings', icon: 'bug' },
  { href: '/app/reports', label: 'Reports', icon: 'report' },
];

export function Shell({ active, user, children, toolbar }: { active: string; user: { name: string; email: string } | null; children: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 14px', color: 'var(--text)', fontWeight: 700 }}>
          <HoundMark size={24} /> Oddhound
        </Link>
        {NAV.map((n) => (
          <Link key={n.href} className="nav" href={n.href} aria-current={active === n.href ? 'page' : undefined}><Icon name={n.icon} /> {n.label}</Link>
        ))}
        <div style={{ marginTop: 'auto', padding: '8px 10px', fontSize: 12.5 }} className="muted">
          {user ? <>Signed in as <strong style={{ color: 'var(--text)' }}>{user.name}</strong><br />{user.email}</> : 'Viewing as a guest'}
          <div style={{ marginTop: 6 }}><Link href="/status">Service status</Link></div>
        </div>
      </nav>
      <div>
        <div className="toolbar">{toolbar}</div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
