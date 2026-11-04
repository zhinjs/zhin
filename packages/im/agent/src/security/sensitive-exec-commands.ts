/**
 * Sensitive CLI subcommand registry for the exec policy (ADR 0044 §7).
 *
 * A platform's own command-line client (for example a daemon CLI that can kick members or move money)
 * is not something the policy can know about. The owning adapter plugin registers the command name and
 * the subcommand patterns it considers sensitive; the policy then lets non-sensitive subcommands through
 * under `allowlist` and routes sensitive ones to owner approval. The registry is name-agnostic: nothing
 * in the agent package mentions a platform.
 */
export interface SensitiveExecCommandRule {
  /** Executable name, matched case-insensitively against the first word of the command. */
  readonly command: string;
  /** A full command line matching any pattern is a sensitive subcommand. */
  readonly sensitive: readonly RegExp[];
}

const rules = new Map<string, readonly RegExp[]>();

/** Register (or replace) the rule for one command. Returns a disposer that removes it. */
export function registerSensitiveExecCommand(rule: SensitiveExecCommandRule): () => void {
  const key = rule.command.trim().toLowerCase();
  if (!key) throw new TypeError('Sensitive exec command rule needs a command name');
  const patterns = Object.freeze([...rule.sensitive]);
  rules.set(key, patterns);
  return () => {
    if (rules.get(key) === patterns) rules.delete(key);
  };
}

/** True when a rule is registered for this executable. */
export function hasSensitiveExecCommand(command: string): boolean {
  return rules.has(command.trim().toLowerCase());
}

/** True when `fullSubCommand` runs a registered executable with a sensitive subcommand. */
export function isSensitiveExecSubcommand(command: string, fullSubCommand: string): boolean {
  const key = command.trim().toLowerCase();
  const patterns = rules.get(key);
  if (!patterns) return false;
  const line = fullSubCommand.trim();
  const head = line.split(/\s+/u, 1)[0]?.toLowerCase();
  return head === key && patterns.some((pattern) => pattern.test(line));
}
