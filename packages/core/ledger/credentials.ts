// Credential vault: target test-account secrets live behind references (cred_…).
// The model only ever sees the reference and a label; the worker resolves the value at fill time.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { Db } from '../db/pool.ts';

function key(): Buffer {
  const raw = process.env.ODDHOUND_CREDENTIAL_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!raw || raw.length < 32) throw new Error('ODDHOUND_CREDENTIAL_KEY (or BETTER_AUTH_SECRET) must be at least 32 characters');
  return createHash('sha256').update(`oddhound-credentials:${raw}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}

export const newCredentialRef = () => `cred_${randomBytes(12).toString('base64url')}`;

export async function storeCredential(db: Db, input: { ref?: string; projectId?: string | null; runId?: string | null; label: string; username: string; secret: string; generated?: boolean }): Promise<string> {
  const ref = input.ref ?? newCredentialRef();
  await db.query(
    `INSERT INTO credentials (ref, project_id, run_id, label, username_enc, secret_enc, generated) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ref, input.projectId ?? null, input.runId ?? null, input.label, encrypt(input.username), encrypt(input.secret), input.generated ?? false]);
  return ref;
}

export async function resolveCredential(db: Db, ref: string): Promise<{ username: string; secret: string; label: string } | null> {
  const r = await db.query<{ label: string; username_enc: string; secret_enc: string }>('SELECT label, username_enc, secret_enc FROM credentials WHERE ref = $1', [ref]);
  const row = r.rows[0];
  return row ? { label: row.label, username: decrypt(row.username_enc), secret: decrypt(row.secret_enc) } : null;
}

/** Generate a synthetic registration identity inside the approved namespace. */
export function syntheticIdentity(runId: string, n: number, emailDomain: string) {
  const tag = runId.replace(/-/g, '').slice(0, 8);
  return {
    name: `Oddhound Tester ${n}`,
    email: `oddhound+${tag}-${n}@${emailDomain}`,
    password: `Oh!${randomBytes(9).toString('base64url')}9a`,
  };
}
