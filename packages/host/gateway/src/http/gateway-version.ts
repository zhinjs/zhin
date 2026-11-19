import { readFileSync } from 'node:fs';

let cachedVersion: string | undefined;
/** `@zhin.js/gateway` version. */
export function gatewayVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    cachedVersion = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch { cachedVersion = '0.0.0'; }
  return cachedVersion;
}
