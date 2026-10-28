/**
 * Host self-configuration paths (#1030 P0).
 *
 * Writing these reconfigures the host itself: its config and secrets, its dependencies (and so the
 * code it runs), its repository hooks. Such a write can loosen hard gates or trigger a restart, so
 * it is a dangerous `self` operation for the hard gate: a fresh human approval every time, never
 * granted by bypass, the auto reviewer, owner exemption or a remembered approval.
 */
import { classifyBashFileOperation } from './file-role-policy.js';

const SEGMENT = String.raw`(?:^|[\\/])`;

const HOST_CONFIG_PATTERNS: readonly RegExp[] = [
  new RegExp(`${SEGMENT}\\.?zhin\\.config(?:\\.[\\w.-]+)?$`, 'i'), // zhin.config.yml/.yaml/.json/.ts, .zhin.config
  new RegExp(`${SEGMENT}\\.env(?:\\.[\\w.-]+)?$`, 'i'),
  new RegExp(`${SEGMENT}package\\.json$`, 'i'),
  new RegExp(`${SEGMENT}(?:pnpm-lock\\.yaml|package-lock\\.json|yarn\\.lock|bun\\.lockb?)$`, 'i'),
  new RegExp(`${SEGMENT}pnpm-workspace\\.yaml$`, 'i'),
  new RegExp(`${SEGMENT}\\.npmrc$`, 'i'),
  new RegExp(`${SEGMENT}\\.pnpmfile\\.c?js$`, 'i'),
  new RegExp(`${SEGMENT}assistant\\.profile\\.ya?ml$`, 'i'), // scheduled routines that run unattended
  new RegExp(`${SEGMENT}node_modules(?:[\\\\/]|$)`, 'i'), // installed code the host loads
  new RegExp(`${SEGMENT}\\.git(?:[\\\\/]|$)`, 'i'), // hooks run code on the next git command
];

/** True when writing `filePath` would change the host's own configuration, dependencies or hooks. */
export function isHostConfigPath(filePath: string): boolean {
  const normalized = filePath.trim();
  return normalized !== '' && HOST_CONFIG_PATTERNS.some(pattern => pattern.test(normalized));
}

/** Native file tools that create, change or delete the file named by `file_path`. */
const FILE_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'apply_patch']);

function stringArg(input: Readonly<Record<string, unknown>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/** Package-manager commands that change installed dependencies, i.e. the code the host loads. */
const DEPENDENCY_CHANGE = /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)\s+(?:-\S+\s+)*(?:add|install|i|remove|rm|uninstall|un|update|up|upgrade|link|unlink|patch-commit|dlx)\b/iu;

/** Strip leading `=`/`:` and trailing `,`/`:` without a regex (avoids ReDoS on long comma runs). */
function stripShellPunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && (word[start] === '=' || word[start] === ':')) start += 1;
  while (end > start && (word[end - 1] === ',' || word[end - 1] === ':')) end -= 1;
  return word.slice(start, end);
}

const SHELL_WORD_BREAK = new Set([' ', '\t', '\n', '\r', ';', '&', '|', '<', '>', '(', ')', '`', '$', "'", '"']);

/** Words of a shell command that could name a file (quotes and redirections stripped). */
function commandWords(command: string): string[] {
  const words: string[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const cleaned = stripShellPunctuation(buf);
    if (cleaned) words.push(cleaned);
    buf = '';
  };
  for (const ch of command) {
    if (SHELL_WORD_BREAK.has(ch)) {
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return words;
}

/**
 * The host config path this tool call would write, if any. File tools are judged by their
 * (already canonicalized) target path; a shell command that writes and names such a path counts too.
 */
export function hostConfigWriteTarget(toolName: string, input: Readonly<Record<string, unknown>>): string | undefined {
  const localName = toolName.split(/[.:/]/u).pop() ?? toolName;
  if (FILE_WRITE_TOOLS.has(localName)) {
    const target = stringArg(input, 'file_path', 'path', 'filePath');
    return target && isHostConfigPath(target) ? target : undefined;
  }
  if (localName === 'bash') {
    const command = stringArg(input, 'command');
    if (!command) return undefined;
    if (DEPENDENCY_CHANGE.test(command)) return 'package.json';
    // Redirections and tee write whatever they name, whatever the command classifies as.
    for (const match of command.matchAll(/(?:\d?>>?|\btee\s+(?:-a\s+)?)\s*["']?([^\s;&|"']+)/gu)) {
      if (isHostConfigPath(match[1]!)) return match[1];
    }
    const operation = classifyBashFileOperation(command);
    if (operation === null || operation === 'read') return undefined;
    return commandWords(command).find(isHostConfigPath);
  }
  return undefined;
}
