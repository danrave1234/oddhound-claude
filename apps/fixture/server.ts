// Harbor Table: Oddhound's own demo target, a small booking app with labelled defects.
//
// Run:  node apps/fixture/server.ts            (vulnerable build, port 4310)
//       node apps/fixture/server.ts --fixed    (corrected build, port 4311)
//
// Seeded defects (vulnerable build only; the corrected build fixes each one):
//   D1 party size below 1 is accepted (server trusts a missing client minimum)
//   D2 a whitespace-only guest name is accepted
//   D3 any signed-in user can open another user's booking (object authorization)
//   D4 on narrow screens a promo banner permanently covers the Book button
//   D5 the party-size field has no programmatic label (accessibility)
//   D6 family 1 (claim vs. truth): editing a booking says "Changes saved." but drops the edited notes
//      (control: notes typed when creating a booking are saved; other edited fields are saved)
//   D3 is also family 2 (two actors): another account can open the booking page by its URL
//      (control: the edit page and the cancel action refuse another account in both builds)
//   D7 family 2 (two tabs): saving the edit form from an out-of-date tab silently undoes a change
//      saved from another tab (control: the same two edits one after the other are both kept)
// Controls that work in both builds: past dates are rejected, party size above 8 is rejected,
// registration validates email/password, and users can only cancel their own bookings.
//
// Synthetic data only. The reset hook exists for the local lab and requires a token.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const fixed = process.argv.includes('--fixed') || process.env.FIXTURE_MODE === 'fixed';
const port = Number(process.env.FIXTURE_PORT ?? (fixed ? 4311 : 4310));
const host = process.env.FIXTURE_HOST ?? '127.0.0.1';
const verifyToken = process.env.ODDHOUND_FIXTURE_VERIFY_TOKEN ?? 'oddhound-demo-target-local-token';
const resetToken = process.env.ODDHOUND_FIXTURE_RESET_TOKEN ?? 'local-lab-reset';

type User = { id: number; name: string; email: string; salt: string; hash: string };
type Booking = { id: number; ownerId: number; guestName: string; partySize: number; date: string; notes: string; status: 'confirmed' | 'cancelled'; version: number };

let users: User[] = [];
let bookings: Booking[] = [];
let sessions = new Map<string, number>();
let nextUserId = 1;
let nextBookingId = 1;

function reset(): void {
  users = []; bookings = []; sessions = new Map(); nextUserId = 1; nextBookingId = 1;
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const today = () => new Date().toISOString().slice(0, 10);

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}
function passwordMatches(user: User, password: string) {
  const { hash } = hashPassword(password, user.salt);
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function currentUser(req: IncomingMessage): User | undefined {
  const sid = /(?:^|;\s*)sid=([a-f0-9]{48})/.exec(req.headers.cookie ?? '')?.[1];
  const uid = sid ? sessions.get(sid) : undefined;
  return users.find((u) => u.id === uid);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function page(title: string, body: string, user?: User): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="oddhound-verification" content="${esc(verifyToken)}">
<title>${esc(title)} · Harbor Table</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1d1d1f;background:#f5f5f7}
  header{background:#fff;border-bottom:1px solid #ddd;padding:12px 20px;display:flex;gap:16px;align-items:center}
  header strong{margin-right:auto}
  main{max-width:640px;margin:0 auto;padding:20px}
  form.stack{display:grid;gap:12px;background:#fff;padding:16px;border-radius:10px;border:1px solid #e3e3e3}
  label{display:grid;gap:4px;font-size:14px}
  input,textarea{font:inherit;padding:8px;border:1px solid #bbb;border-radius:6px}
  button{font:inherit;padding:10px 14px;border-radius:8px;border:0;background:#0a66c2;color:#fff;cursor:pointer}
  table{width:100%;border-collapse:collapse;background:#fff}
  td,th{border-bottom:1px solid #eee;padding:8px;text-align:left}
  .error{color:#b00020;background:#fdecee;padding:8px 10px;border-radius:6px}
  .notice{color:#0b5d1e;background:#e7f6ea;padding:8px 10px;border-radius:6px}
  .promo{display:none}
  @media (max-width:480px){
    .promo{display:block;position:fixed;left:0;right:0;bottom:0;height:150px;background:#ffcc00;color:#000;padding:16px;font-weight:600;z-index:10}
    ${fixed ? 'body{padding-bottom:170px} .promo{height:auto;position:static;margin-top:16px}' : ''}
  }
</style></head><body>
<header><strong>Harbor Table</strong>${user
    ? `<span>Signed in as ${esc(user.name)}</span><a href="/bookings">My bookings</a><form method="post" action="/logout"><button type="submit">Log out</button></form>`
    : '<a href="/login">Log in</a><a href="/register">Create account</a>'}</header>
<main>${body}</main>
<div class="promo" role="note">Autumn special: 10% off weekday dinners! Show this banner at the door.</div>
</body></html>`;
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(html);
}
function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}) {
  res.writeHead(303, { location, 'cache-control': 'no-store', ...headers });
  res.end();
}
function startSession(user: User): string {
  const sid = randomBytes(24).toString('hex');
  sessions.set(sid, user.id);
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`;
}

function bookingForm(action: string, values: Partial<Record<'guest_name' | 'party_size' | 'date' | 'notes' | 'version', string>>, error?: string, submitLabel = 'Book table'): string {
  // D5: the vulnerable build gives the party-size input a placeholder but no label.
  const partyField = fixed
    ? `<label>Party size<input name="party_size" type="number" min="1" max="8" required value="${esc(values.party_size ?? '')}"></label>`
    : `<div><input name="party_size" type="number" max="8" required placeholder="Party size" value="${esc(values.party_size ?? '')}"></div>`;
  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form class="stack" method="post" action="${esc(action)}">
  ${values.version !== undefined ? `<input type="hidden" name="version" value="${esc(values.version)}">` : ''}
  <label>Guest name<input name="guest_name" required value="${esc(values.guest_name ?? '')}"></label>
  ${partyField}
  <label>Date<input name="date" type="date" required value="${esc(values.date ?? '')}"></label>
  <label>Notes (optional)<textarea name="notes" rows="2">${esc(values.notes ?? '')}</textarea></label>
  <p class="policy">Booking policy: tables are held for 15 minutes after the booking time. Please cancel at least
  two hours ahead so another guest can use the table. Parties larger than eight guests should call the restaurant.
  Seating is indoors; tell us in the notes if you need step-free access, a high chair or a quieter table, and we
  will do our best to arrange it. Bookings are confirmed instantly and appear in My bookings.</p>
  <button type="submit">${esc(submitLabel)}</button>
</form>`;
}

function validateBooking(form: URLSearchParams): { error?: string; value?: Omit<Booking, 'id' | 'ownerId' | 'status' | 'version'> } {
  const rawName = form.get('guest_name') ?? '';
  const guestName = fixed ? rawName.trim() : rawName;
  if (guestName.length === 0) return { error: 'Guest name is required.' }; // D2: '   ' passes in the vulnerable build
  const partySize = Number(form.get('party_size'));
  if (!Number.isInteger(partySize)) return { error: 'Party size must be a whole number.' };
  if (partySize > 8) return { error: 'We can seat at most 8 guests per booking.' };
  if (fixed && partySize < 1) return { error: 'Party size must be at least 1.' }; // D1 is the missing check
  const date = form.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a valid date.' };
  if (date < today()) return { error: 'Bookings cannot be in the past.' };
  const notes = (form.get('notes') ?? '').slice(0, 500);
  return { value: { guestName, partySize, date, notes } };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const user = currentUser(req);

    if (path === '/.well-known/oddhound-verify.txt' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(`${verifyToken}\n`);
    }
    if (path === '/__lab/reset' && req.method === 'POST') {
      if (req.headers['x-lab-reset-token'] !== resetToken) return send(res, 403, 'forbidden');
      reset();
      res.writeHead(204); return res.end();
    }
    if (path === '/__lab/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, build: fixed ? 'fixed' : 'vulnerable' })); }

    if (path === '/' && req.method === 'GET') {
      return send(res, 200, page('Welcome', `<h1>Book a table at Harbor Table</h1>
<p>Create an account, book a table for up to 8 guests, and manage or cancel your bookings online.</p>
<p><a href="/register">Create an account</a> or <a href="/login">log in</a> to get started.</p>`, user));
    }

    if (path === '/register') {
      if (req.method === 'GET') return send(res, 200, page('Create account', `<h1>Create account</h1>${registerForm({})}`, user));
      if (req.method === 'POST') {
        const form = await readForm(req);
        const name = (form.get('name') ?? '').trim();
        const email = (form.get('email') ?? '').trim().toLowerCase();
        const password = form.get('password') ?? '';
        let error = '';
        if (!name) error = 'Name is required.';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'Enter a valid email address.';
        else if (password.length < 8) error = 'Password must be at least 8 characters.';
        else if (users.some((u) => u.email === email)) error = 'An account with this email already exists.';
        if (error) return send(res, 422, page('Create account', `<h1>Create account</h1>${registerForm({ name, email }, error)}`));
        const created: User = { id: nextUserId++, name, email, ...hashPassword(password) };
        users.push(created);
        return redirect(res, '/bookings?welcome=1', { 'set-cookie': startSession(created) });
      }
    }

    if (path === '/login') {
      if (req.method === 'GET') return send(res, 200, page('Log in', `<h1>Log in</h1>${loginForm({})}`, user));
      if (req.method === 'POST') {
        const form = await readForm(req);
        const email = (form.get('email') ?? '').trim().toLowerCase();
        const found = users.find((u) => u.email === email);
        if (!found || !passwordMatches(found, form.get('password') ?? '')) {
          return send(res, 401, page('Log in', `<h1>Log in</h1>${loginForm({ email }, 'Email or password is incorrect.')}`));
        }
        return redirect(res, '/bookings', { 'set-cookie': startSession(found) });
      }
    }

    if (path === '/logout' && req.method === 'POST') {
      const sid = /(?:^|;\s*)sid=([a-f0-9]{48})/.exec(req.headers.cookie ?? '')?.[1];
      if (sid) sessions.delete(sid);
      return redirect(res, '/', { 'set-cookie': 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    }

    if (path.startsWith('/bookings') && !user) return redirect(res, '/login');

    if (path === '/bookings' && req.method === 'GET' && user) {
      const mine = bookings.filter((b) => b.ownerId === user.id);
      const rows = mine.map((b) => `<tr><td><a href="/bookings/${b.id}">#${b.id}</a></td><td>${esc(b.guestName)}</td><td>${b.partySize}</td><td>${esc(b.date)}</td><td>${b.status}</td></tr>`).join('');
      return send(res, 200, page('My bookings', `<h1>My bookings</h1>
${url.searchParams.get('welcome') ? '<p class="notice">Your account is ready.</p>' : ''}
${url.searchParams.get('created') ? `<p class="notice">Booking #${esc(url.searchParams.get('created'))} confirmed.</p>` : ''}
<p><a href="/bookings/new">New booking</a></p>
${mine.length ? `<table><thead><tr><th>Booking</th><th>Guest</th><th>Party</th><th>Date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>You have no bookings yet.</p>'}`, user));
    }

    if (path === '/bookings/new' && user) {
      if (req.method === 'GET') return send(res, 200, page('New booking', `<h1>New booking</h1>${bookingForm('/bookings', {})}`, user));
    }
    if (path === '/bookings' && req.method === 'POST' && user) {
      const form = await readForm(req);
      const result = validateBooking(form);
      if (result.error) return send(res, 422, page('New booking', `<h1>New booking</h1>${bookingForm('/bookings', Object.fromEntries(form), result.error)}`, user));
      const booking: Booking = { id: nextBookingId++, ownerId: user.id, status: 'confirmed', ...result.value!, version: 1 };
      bookings.push(booking);
      return redirect(res, `/bookings?created=${booking.id}`);
    }

    const match = /^\/bookings\/(\d+)(\/edit|\/cancel)?$/.exec(path);
    if (match && user) {
      const booking = bookings.find((b) => b.id === Number(match[1]));
      const owns = booking?.ownerId === user.id;
      // D3: the vulnerable build lets any signed-in user view any booking.
      if (!booking || (!owns && (fixed || match[2]))) return send(res, 404, page('Not found', '<h1>Booking not found</h1>', user));
      if (!match[2] && req.method === 'GET') {
        return send(res, 200, page(`Booking #${booking.id}`, `<h1>Booking #${booking.id}</h1>
${url.searchParams.get('saved') ? '<p class="notice" role="status">Changes saved.</p>' : ''}
<dl><dt>Guest</dt><dd data-field="guest_name">${esc(booking.guestName)}</dd><dt>Party size</dt><dd data-field="party_size">${booking.partySize}</dd>
<dt>Date</dt><dd data-field="date">${esc(booking.date)}</dd><dt>Notes</dt><dd data-field="notes">${esc(booking.notes)}</dd><dt>Status</dt><dd data-field="status">${booking.status}</dd></dl>
${owns && booking.status === 'confirmed' ? `<p><a href="/bookings/${booking.id}/edit">Edit booking</a></p><form method="post" action="/bookings/${booking.id}/cancel"><button type="submit">Cancel booking</button></form>` : ''}`, user));
      }
      if (match[2] === '/edit') {
        if (req.method === 'GET') return send(res, 200, page('Edit booking', `<h1>Edit booking #${booking.id}</h1>${bookingForm(`/bookings/${booking.id}/edit`, { guest_name: booking.guestName, party_size: String(booking.partySize), date: booking.date, notes: booking.notes, version: String(booking.version) }, undefined, 'Save changes')}`, user));
        if (req.method === 'POST') {
          const form = await readForm(req);
          // D7: only the corrected build notices that the form was opened before another save.
          if (fixed && Number(form.get('version')) !== booking.version) {
            return send(res, 409, page('Edit booking', `<h1>Edit booking #${booking.id}</h1>${bookingForm(`/bookings/${booking.id}/edit`, { guest_name: booking.guestName, party_size: String(booking.partySize), date: booking.date, notes: booking.notes, version: String(booking.version) }, 'This booking was changed in another tab or on another device. Check the details below and save again.', 'Save changes')}`, user));
          }
          const result = validateBooking(form);
          if (result.error) return send(res, 422, page('Edit booking', `<h1>Edit booking #${booking.id}</h1>${bookingForm(`/bookings/${booking.id}/edit`, Object.fromEntries(form), result.error, 'Save changes')}`, user));
          // D6: the vulnerable build keeps the old notes but still reports the save as done.
          Object.assign(booking, fixed ? result.value : { ...result.value, notes: booking.notes });
          booking.version++;
          return redirect(res, `/bookings/${booking.id}?saved=1`);
        }
      }
      if (match[2] === '/cancel' && req.method === 'POST') {
        booking.status = 'cancelled';
        return redirect(res, `/bookings/${booking.id}`);
      }
    }

    return send(res, 404, page('Not found', '<h1>Page not found</h1>', user));
  } catch {
    if (!res.headersSent) send(res, 500, page('Error', '<h1>Something went wrong</h1>'));
    else res.end();
  }
});

function registerForm(values: { name?: string; email?: string }, error?: string) {
  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form class="stack" method="post" action="/register">
  <label>Full name<input name="name" required value="${esc(values.name ?? '')}"></label>
  <label>Email<input name="email" type="email" required value="${esc(values.email ?? '')}"></label>
  <label>Password<input name="password" type="password" required minlength="8"></label>
  <button type="submit">Create account</button>
</form>`;
}
function loginForm(values: { email?: string }, error?: string) {
  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form class="stack" method="post" action="/login">
  <label>Email<input name="email" type="email" required value="${esc(values.email ?? '')}"></label>
  <label>Password<input name="password" type="password" required></label>
  <button type="submit">Log in</button>
</form>`;
}

server.listen(port, host, () => {
  console.log(JSON.stringify({ fixture: 'harbor-table', build: fixed ? 'fixed' : 'vulnerable', url: `http://${host}:${port}` }));
});
