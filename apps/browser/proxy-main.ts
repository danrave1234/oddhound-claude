// Egress proxy process inside the browser image. Listens on 127.0.0.1:3128 only; it is the browser
// user's sole route out (nftables drops everything else from that user).
import { startEgressProxy } from './core/net/egress-proxy.ts';
import { labProfileFromEnv } from './core/net/ip-policy.ts';

const lab = labProfileFromEnv();
await startEgressProxy({
  listenPort: 3128,
  lab,
  onDecision: (d) => { if (!d.allowed) console.log(JSON.stringify({ egress: 'denied', host: d.host, port: d.port, reason: d.reason })); },
  onExhausted: (r) => console.log(JSON.stringify({ egress: 'exhausted', reason: r })),
});
console.log(JSON.stringify({ proxy: 'listening', port: 3128, lab: Boolean(lab) }));
