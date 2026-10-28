import Link from 'next/link';
import { HoundMark, Icon } from '@/ui/icons';
import { authConfig } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  return (
    <main className="center-page">
      <div style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 16 }}>
        <Link href="/" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }}><Icon name="back" /> Back to Oddhound</Link>
        <div className="card auth-card rise-in">
          <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 10, marginBottom: 22 }}>
            <HoundMark size={52} tile />
            <h1 className="h1" style={{ fontSize: 24 }}>Sign in to Oddhound</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Verify your sites and run Oddhound on them.</p>
          </div>
          <LoginForm github={authConfig.github} devLogin={authConfig.devLogin} next={safeNext} />
        </div>
        <p className="muted" style={{ textAlign: 'center', fontSize: 12.5, margin: 0 }}>Just looking? The <Link href="/">demo target and replay</Link> need no account.</p>
      </div>
    </main>
  );
}
