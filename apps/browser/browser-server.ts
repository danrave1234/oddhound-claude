// Playwright browser server inside the browser image. Launch options are fixed HERE, not by the
// client: Chromium sandbox on, all traffic via the local egress proxy (loopback included), no
// downloads. The controller connects with chromium.connect(ws://<private address>:3000<RUN_WS_PATH>).
import { chromium } from 'playwright';

const wsPath = process.env.RUN_WS_PATH;
if (!wsPath || !/^\/[A-Za-z0-9_-]{24,}$/.test(wsPath)) {
  console.error(JSON.stringify({ error: 'RUN_WS_PATH must be a random path of at least 24 characters' }));
  process.exit(64);
}
if (process.getuid?.() === 0) {
  console.error(JSON.stringify({ error: 'refusing to run the browser as root' }));
  process.exit(65);
}

const server = await chromium.launchServer({
  channel: 'chromium',
  headless: true,
  chromiumSandbox: true,
  // Fly's private 6PN network is IPv6 ('::' also accepts IPv4 in the local Docker lab). The app has no
  // public service or IP; the random per-run path is required to connect.
  host: '::',
  port: 3000,
  wsPath,
  proxy: { server: 'http://127.0.0.1:3128', bypass: '<-loopback>' },
  args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
});
console.log(JSON.stringify({ browserServer: 'ready', uid: process.getuid?.(), port: 3000 }));
const shutdown = async () => { await server.close().catch(() => {}); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
