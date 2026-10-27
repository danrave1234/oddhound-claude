import { runtimeFromEnv } from '../../packages/core/browser/select.ts';
import { newScopedContext } from '../../packages/core/browser/runtime.ts';
const pb = await runtimeFromEnv().provision({ runId: '00000000-geo-probe' });
try {
  const ctx = await newScopedContext(pb.browser, 'mobile');
  const p = await ctx.newPage();
  const origin = process.env.DEMO_TARGET_ORIGIN!;
  await p.goto(`${origin}/register`);
  await p.getByLabel('Full name').fill('Geo'); await p.getByLabel('Email').fill(`geo${Date.now()}@example.test`); await p.getByLabel('Password').fill('password123');
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.goto(`${origin}/bookings/new`);
  await p.evaluate(() => window.scrollTo(0, 99999));
  console.log(await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/Book/.test(x.textContent ?? ''))!; const r=b.getBoundingClientRect(); const pr=document.querySelector('.promo')!.getBoundingClientRect(); return {btn:[Math.round(r.top),Math.round(r.bottom)], promo:[Math.round(pr.top),Math.round(pr.bottom)], scrollH: document.documentElement.scrollHeight, inner: innerHeight, scrollY: scrollY}; }));
  console.log('sandbox', pb.sandboxVerdict);
} finally { console.log(await pb.destroy()); }
