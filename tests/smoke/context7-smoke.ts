// Context7 smoke: one real lookup (public docs only), plus graceful failure on an unreachable endpoint.
import { fetchDocs } from '../../packages/core/integrations/context7.ts';
const ok = await fetchDocs('next.js', 'server-side validation of form input in request handlers');
console.log(ok ? `PASS  docs for ${ok.library}: ${ok.excerpt.length} chars` : 'FAIL  no docs returned');
const none = await fetchDocs('definitely-not-a-real-library-xyz', 'anything', { timeoutMs: 8000 });
console.log(none === null ? 'PASS  unknown library degrades to null' : `NOTE  unexpected docs for unknown library: ${none.library}`);
process.exit(ok ? 0 : 1);
