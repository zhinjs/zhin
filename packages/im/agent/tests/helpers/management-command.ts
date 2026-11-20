import type { Locale } from '@zhin.js/plugin-runtime';
import { createRuntimeManagementCommands, type RuntimeManagementCommandHost } from '../../src/init/runtime-management-commands.js';

/**
 * Runs one Agent management Root command's `execute` directly (no dispatch, permits not checked),
 * the way the command dispatch calls it with prefix `/`.
 */
export async function runManagementCommand(name: string, input: Readonly<{
  args?: readonly string[];
  senderId?: string;
  locale?: Locale;
  host?: Partial<RuntimeManagementCommandHost>;
}>): Promise<unknown> {
  const commands = createRuntimeManagementCommands({
    zhinAgent: {} as never,
    open: async (_message, _signal, run) => run({ sessionKey: 'session' }),
    ...input.host,
  });
  const command = commands.find(entry => entry.name === name);
  if (!command) throw new Error(`No management command ${name}`);
  return command.definition.execute({
    locale: input.locale ?? 'zh-CN',
    args: input.args ?? [],
    params: {},
    options: {},
    segments: [],
    signal: new AbortController().signal,
    formatCommand: (path: string) => `/${path}`,
    input: {
      conversation: { endpoint: { id: 'ep', adapter: 'qq' }, kind: 'private', id: input.senderId ?? 'u' },
      content: '',
      ...(input.senderId ? { sender: { id: input.senderId } } : {}),
    },
  } as never);
}
