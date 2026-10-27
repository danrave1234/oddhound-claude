// Loads the workspace .env (if present) into process.env, then runs the Next.js CLI.
// (Next copies node flags into NODE_OPTIONS for its workers, where --env-file is not allowed.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
await import('next/dist/bin/next');
