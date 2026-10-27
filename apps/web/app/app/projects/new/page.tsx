import { redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { currentUser, mayScanVerifiedSites } from '@/lib/server';
import { NewProjectForm } from './form';

export const metadata = { title: 'New project' };

export default async function NewProject() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app/projects/new');
  if (!mayScanVerifiedSites(user)) redirect('/app');
  return (
    <Shell active="/app" user={user} toolbar={<strong>New project</strong>}>
      <div className="card" style={{ padding: 20, maxWidth: 640 }}>
        <p className="muted" style={{ marginTop: 0 }}>Step 1 of 3 · Add the site. Next you will prove you own it, then approve what Oddhound may do.</p>
        <NewProjectForm />
      </div>
    </Shell>
  );
}
