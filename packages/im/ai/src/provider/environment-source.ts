import { parseEnvironmentReference, type EnvironmentReferenceOperator } from '@zhin.js/plugin-runtime';

/** One complete environment-default template; the fallback can itself be secret. Never include this result in public metadata. */
export interface CredentialEnvironmentExpression {
  readonly variable: string;
  readonly operator: EnvironmentReferenceOperator;
  readonly fallback: string;
}

/**
 * Pure syntax check: a whole `${VAR:-default}` / `${VAR:=default}` reference (the expander's own
 * parser, `@zhin.js/plugin-runtime` `parseEnvironmentReference`). Expansion belongs to the Host's
 * existing environment store, not migration or model code.
 */
export function parseCredentialEnvironmentExpression(input: unknown): CredentialEnvironmentExpression | undefined {
  const reference = parseEnvironmentReference(input);
  if (reference?.operator === undefined || reference.default === undefined) return undefined;
  return Object.freeze({ variable: reference.variable, operator: reference.operator, fallback: reference.default });
}
