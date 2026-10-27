import { notFound } from 'next/navigation';
import { canControlRun, canViewRun, currentUser, loadRunForAccess } from '@/lib/server';
import { loadRunSnapshot } from '@/lib/run-data';
import { RunWorkspace } from './workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Run' };

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ replay?: string }> }) {
  const { id } = await params;
  const { replay } = await searchParams;
  const access = await loadRunForAccess(id);
  const user = await currentUser();
  if (!access || !canViewRun(user, access)) notFound();
  const snapshot = await loadRunSnapshot(id);
  if (!snapshot) notFound();
  const controllable = !replay && (await canControlRun(user, access));
  return <RunWorkspace initial={JSON.parse(JSON.stringify(snapshot))} controllable={controllable} replay={Boolean(replay)} signedIn={Boolean(user)} />;
}
