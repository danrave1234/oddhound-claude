import Link from 'next/link';
import { HoundMark } from '@/ui/icons';
import { authConfig } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: 24 }} className="card">
      <Link href="/" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--text)', fontWeight: 700 }}><HoundMark /> Oddhound</Link>
      <h1 style={{ fontSize: 22, margin: '18px 0 6px' }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 0 }}>Sign in to verify your sites and run Oddhound on them. The demo target needs no account.</p>
      <LoginForm github={authConfig.github} devLogin={authConfig.devLogin} next={safeNext} />
    </main>
  );
}
