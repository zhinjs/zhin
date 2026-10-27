import type { Locale } from '@zhin.js/plugin-runtime';

/** Per-operation presentation for the Host's existing, unnamespaced management commands. */
export interface AgentCommandPresentation {
  readonly locale?: Locale;
  /** The actual ingress dispatcher prefix; undefined means no known command environment. */
  readonly commandPrefix?: string;
}

export function managementCommandText(content: string, prefix: string | undefined): string | undefined {
  const text = content.trim();
  return prefix !== undefined && text.startsWith(prefix) ? text.slice(prefix.length).trim() : undefined;
}

export function managementCommandReference(command: string, prefix: string | undefined): string | undefined {
  return prefix === undefined ? undefined : `${prefix}${command}`;
}
