/**
 * Interactive prompts need a terminal: without one (a pipe, `< /dev/null`, CI, an agent) inquirer
 * waits for an answer that never comes (#1250). Commands check this before prompting and fail
 * fast with the non-interactive flag to use instead.
 */

/** True when standard input is a terminal, so inquirer can ask. */
export function stdinIsInteractive(stream: { isTTY?: boolean } = process.stdin): boolean {
  return stream.isTTY === true;
}

/** The message for a prompt that cannot run: `<what>需要交互式终端（标准输入不是终端）：<hint>`. */
export function nonInteractiveMessage(what: string, hint: string): string {
  return `${what}需要交互式终端（标准输入不是终端）：${hint}`;
}

/** Thrown instead of prompting when standard input is not a terminal. */
export class NonInteractiveError extends Error {
  constructor(what: string, hint: string) {
    super(nonInteractiveMessage(what, hint));
    this.name = 'NonInteractiveError';
  }
}
