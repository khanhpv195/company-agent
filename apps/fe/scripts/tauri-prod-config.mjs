// Writes src-tauri/tauri.prod.conf.json (gitignored): a Tauri config override whose CSP allows
// the API origin from VITE_API_URL. Used by `pnpm tauri:build` via `tauri build --config`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { apiOrigin, buildConfigOverride, readEnvValue } from './prod-csp.mjs';

const root = new URL('../', import.meta.url);

function resolveApiUrl() {
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL;
  // Same precedence as Vite for a production build: .env.production over .env.
  for (const name of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const file = new URL(name, root);
    if (!existsSync(file)) continue;
    const v = readEnvValue(readFileSync(file, 'utf8'), 'VITE_API_URL');
    if (v) return v;
  }
  return undefined;
}

try {
  const apiUrl = resolveApiUrl();
  const config = buildConfigOverride(apiUrl);
  const out = new URL('src-tauri/tauri.prod.conf.json', root);
  writeFileSync(out, JSON.stringify(config, null, 2) + '\n');
  console.log(`API origin ${apiOrigin(apiUrl)} -> ${fileURLToPath(out)}`);
  console.log(`connect-src: ${config.app.security.csp['connect-src']}`);
} catch (e) {
  console.error(`tauri-prod-config: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
