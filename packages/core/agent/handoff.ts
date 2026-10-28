// Owner sign-in handoff: before the agent starts, the owner signs in themselves through a live view
// of the run's fresh browser. The worker publishes a frame of the page a few times a second and
// applies the owner's clicks and keystrokes. What the owner types is encrypted in transit through the
// database, deleted once applied, never logged in clear and never shown to the model. The resulting
// signed-in session stays in this worker's memory for this run only.

import { z } from 'zod';
import type { Db } from '../db/pool.ts';
import { encrypt, decrypt } from '../ledger/credentials.ts';
import { assertLease } from '../ledger/runs.ts';
import type { RunSession } from './session.ts';

export const HANDOFF_KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space'] as const;

export const HandoffInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }),
  z.object({ type: z.literal('type'), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal('key'), key: z.enum(HANDOFF_KEYS) }),
  z.object({ type: z.literal('scroll'), dy: z.number().min(-3000).max(3000) }),
  z.object({ type: z.literal('navigate'), path: z.string().startsWith('/').max(300) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('cancel') }),
]);
export type HandoffInput = z.infer<typeof HandoffInputSchema>;

/** Queue one owner input for the worker (called by the web app after authorization). */
export async function queueHandoffInput(db: Db, runId: string, input: HandoffInput): Promise<void> {
  await db.query('INSERT INTO run_handoff_inputs (run_id, kind, payload_enc) VALUES ($1, $2, $3)', [runId, input.type, encrypt(JSON.stringify(input))]);
}

export class HandoffEnded extends Error {
  readonly reason: 'handoff_cancelled' | 'handoff_timed_out';
  constructor(reason: 'handoff_cancelled' | 'handoff_timed_out') { super(reason); this.reason = reason; }
}

export const HANDOFF_LIMIT_MS = 30 * 60_000; // raised from 10 min (Oct 29, owner decision): owners kept missing the window
const FRAME_EVERY_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ev = (t: string, p?: Record<string, unknown>) => Promise<number>;

/**
 * Run the handoff until the owner presses "start testing". Returns the signed-in storage state.
 * Throws HandoffEnded when the owner cancels or the time limit passes; lease/stop fences propagate.
 */
export async function runHandoff(a: { db: Db; runId: string; generation: number; session: RunSession; startPath: string; ev: Ev; signal: AbortSignal; limitMs?: number }) {
  const { db, runId, generation, session, ev, signal } = a;
  const origin = session.origin;
  const deadline = Date.now() + (a.limitMs ?? HANDOFF_LIMIT_MS);
  const page = await session.page();
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const thirdParty = new Set<string>();
  const onRequest = (r: { url: () => string }) => {
    try { const o = new URL(r.url()).origin; if (o !== origin && thirdParty.size < 30) thirdParty.add(o); } catch { /* ignore */ }
  };
  page.on('request', onRequest);
  session.setHandoff(true);
  let seq = 0;
  try {
    await page.goto(new URL(a.startPath, origin).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await ev('handoff.started', { startPath: a.startPath, limitMinutes: Math.round((a.limitMs ?? HANDOFF_LIMIT_MS) / 60_000) });
    let lastFrame = 0;
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      if (Date.now() > deadline) { await ev('handoff.timed_out', {}); throw new HandoffEnded('handoff_timed_out'); }
      await assertLease(db, runId, generation); // also the heartbeat while the owner signs in
      const inputs = (await db.query<{ id: string; payload_enc: string }>('SELECT id, payload_enc FROM run_handoff_inputs WHERE run_id = $1 ORDER BY id LIMIT 50', [runId])).rows;
      let finished = false;
      for (const row of inputs) {
        await db.query('DELETE FROM run_handoff_inputs WHERE id = $1', [row.id]);
        let input: HandoffInput;
        try { input = HandoffInputSchema.parse(JSON.parse(decrypt(row.payload_enc))); } catch { continue; }
        if (input.type === 'cancel') { await ev('handoff.cancelled', {}); throw new HandoffEnded('handoff_cancelled'); }
        if (input.type === 'done') { finished = true; break; }
        await applyInput(session, input, origin);
        // Facts only: what kind of input, never what was typed.
        await ev('handoff.input', input.type === 'type' ? { type: 'type', characters: input.text.length } : input.type === 'click' ? { type: 'click' } : input.type === 'navigate' ? { type: 'navigate', path: input.path } : { type: input.type, ...(input.type === 'key' ? { key: input.key } : {}) });
      }
      if (finished) break;
      if (inputs.length || Date.now() - lastFrame >= FRAME_EVERY_MS) {
        const current = await session.page();
        const frame = await current.screenshot({ type: 'jpeg', quality: 60, fullPage: false }).catch(() => null);
        if (frame) {
          let path = '';
          try { const u = new URL(current.url()); path = u.origin === origin ? u.pathname : `${u.origin}${u.pathname}`; } catch { path = ''; }
          await db.query(`INSERT INTO run_live_frames (run_id, seq, path, width, height, frame) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (run_id) DO UPDATE SET seq = EXCLUDED.seq, path = EXCLUDED.path, width = EXCLUDED.width, height = EXCLUDED.height, frame = EXCLUDED.frame, updated_at = now()`,
            [runId, ++seq, path.slice(0, 300), viewport.width, viewport.height, frame]);
        }
        lastFrame = Date.now();
      }
      if (!inputs.length) await sleep(150);
    }
    // Back to the verified site before the agent takes over.
    const current = await session.page();
    let onSite = false;
    try { onSite = new URL(current.url()).origin === origin; } catch { onSite = false; }
    if (!onSite) await current.goto(`${origin}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    session.setHandoff(false);
    const state = await session.storageState();
    const landed = (() => { try { return new URL(current.url()).pathname; } catch { return '/'; } })();
    await ev('handoff.completed', { landedPath: landed, cookies: state?.cookies.filter((c) => origin.endsWith(c.domain.replace(/^\./, ''))).length ?? 0, otherOriginsContacted: [...thirdParty].slice(0, 10) });
    return state;
  } finally {
    session.setHandoff(false);
    page.off('request', onRequest);
    await db.query('DELETE FROM run_live_frames WHERE run_id = $1', [runId]).catch(() => {});
    await db.query('DELETE FROM run_handoff_inputs WHERE run_id = $1', [runId]).catch(() => {});
  }
}

async function applyInput(session: RunSession, input: HandoffInput, origin: string): Promise<void> {
  const page = await session.page();
  try {
    switch (input.type) {
      case 'click': await page.mouse.click(input.x, input.y); break;
      case 'type': await page.keyboard.type(input.text, { delay: 15 }); break;
      case 'key': await page.keyboard.press(input.key === 'Space' ? ' ' : input.key); break;
      case 'scroll': await page.mouse.wheel(0, input.dy); break;
      case 'navigate': {
        const target = new URL(input.path, origin);
        if (target.origin === origin) await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
        break;
      }
      case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); break;
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  } catch { /* a failed click or a slow page must not end the handoff */ }
}
