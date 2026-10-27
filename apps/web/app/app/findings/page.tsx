import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { StatusBadge, findingStatus } from '@/ui/status';
import { currentUser, db } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Findings' };

const CATEGORIES = ['verified_issue', 'needs_review', 'configuration_observation', 'suggestion'] as const;

export default async function Findings({ searchParams }: { searchParams: Promise<{ category?: string; device?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app/findings');
  const { category, device } = await searchParams;
  const cat = CATEGORIES.includes(category as never) ? category! : 'verified_issue';
  const dev = device === 'desktop' || device === 'mobile' ? device : null;
  const rows = (await db().query(`SELECT f.id, f.run_id, f.title, f.verification, f.lifecycle, f.impact, f.device, f.rule_id, f.updated_at, p.name AS project
    FROM findings f JOIN runs r ON r.id = f.run_id LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.owner_id = $1 AND f.category = $2 AND ($3::text IS NULL OR f.device = $3) ORDER BY f.updated_at DESC LIMIT 200`, [user.id, cat, dev])).rows;
  const q = (c: string, d: string | null) => `/app/findings?category=${c}${d ? `&device=${d}` : ''}`;
  return (
    <Shell active="/app/findings" user={user} toolbar={<>
      <strong>Findings</strong>
      <nav className="segmented" aria-label="Category" style={{ marginLeft: 12 }}>
        {CATEGORIES.map((c) => <Link key={c} href={q(c, dev)} aria-current={c === cat ? 'page' : undefined} style={{ padding: '4px 10px', borderRadius: 6, color: 'var(--text)', background: c === cat ? 'var(--surface)' : undefined }}>{c.replace(/_/g, ' ')}</Link>)}
      </nav>
      <nav className="segmented" aria-label="Device">
        {[null, 'desktop', 'mobile'].map((d) => <Link key={d ?? 'all'} href={q(cat, d)} aria-current={d === dev ? 'page' : undefined} style={{ padding: '4px 10px', borderRadius: 6, color: 'var(--text)', background: d === dev ? 'var(--surface)' : undefined }}>{d ?? 'all devices'}</Link>)}
      </nav>
    </>}>
      <div className="card">
        <table className="grid"><thead><tr><th>Title</th><th>Status</th><th>Impact</th><th>Device</th><th>Rule</th><th>Project</th><th>Last observed</th></tr></thead><tbody>
          {rows.length ? rows.map((f) => (
            <tr key={f.id}><td><Link href={`/runs/${f.run_id}`}>{f.title}</Link></td><td><StatusBadge value={findingStatus({ category: cat, verification: f.verification, lifecycle: f.lifecycle })} /></td><td>{f.impact}</td><td>{f.device}</td>
              <td className="mono">{f.rule_id ?? '—'}</td><td>{f.project ?? '—'}</td><td className="muted">{new Date(f.updated_at).toLocaleString()}</td></tr>
          )) : <tr><td colSpan={7} className="muted">Nothing in this category.</td></tr>}
        </tbody></table>
      </div>
    </Shell>
  );
}
