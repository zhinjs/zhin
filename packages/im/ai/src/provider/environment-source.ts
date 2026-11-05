/** One complete environment-default template; the fallback can itself be secret. Never include this result in public metadata. */
export interface CredentialEnvironmentExpression {
  readonly variable: string;
  readonly operator: ':-' | ':=';
  readonly fallback: string;
}

/** Pure syntax check. Expansion belongs to the Host's existing environment store, not migration or model code. */
export function parseCredentialEnvironmentExpression(input: unknown): CredentialEnvironmentExpression | undefined {
  if (typeof input !== 'string') return undefined;
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:[-=])([^{}]*)\}$/u.exec(input);
  if (!match) return undefined;
  return Object.freeze({ variable: match[1]!, operator: match[2]! as ':-' | ':=', fallback: match[3]! });
}
