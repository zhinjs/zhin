import { expandEnvironmentValue } from '@zhin.js/runtime';
import type { EnvironmentExpressionSource } from './credentials.js';

/** Called only after the private source has been validated by the account runtime. Never loads dotenv. */
export function resolveHostCredentialSource(
  source: string | EnvironmentExpressionSource,
  lookup: (name: string) => string | undefined,
): string | undefined {
  if (typeof source !== 'string') return expandEnvironmentValue(source.expression, lookup);
  const match = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(source);
  return match ? lookup(match[1]!) : undefined;
}
