/**
 * pnpm 11 forwards a literal `--` separator to the script
 * (`pnpm --filter @agent/cli start -- connect` runs `node dist/main.js -- connect`).
 * Commander would then treat everything after it as positional arguments and
 * report missing options, so drop that one separator right after the script path.
 */
export function normalizeArgv(argv: readonly string[]): string[] {
  const out = [...argv];
  if (out[2] === '--') out.splice(2, 1);
  return out;
}
