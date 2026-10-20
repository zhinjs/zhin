import type { AgentTool } from '@zhin.js/ai';

export interface PreExecuteResult {
  tools: AgentTool[];
  data: string;
}

export async function runPreExecutableTools(
  tools: AgentTool[],
  timeoutMs: number,
): Promise<PreExecuteResult> {
  const preExecTools = tools.filter(tool => tool.preExecutable);
  let data = '';
  if (preExecTools.length === 0) {
    return { tools: preExecTools, data };
  }

  const results = await Promise.allSettled(
    preExecTools.map(async (tool) => {
      const result = await Promise.race([
        tool.execute({}),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('超时')), timeoutMs)),
      ]);
      return { name: tool.name, result };
    }),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    let s = typeof r.value.result === 'string' ? r.value.result : JSON.stringify(r.value.result);
    if (s.length > 500) {
      s = s.slice(0, 500) + `\n... (truncated, ${s.length} chars total)`;
    }
    data += `\n【${r.value.name}】${s}`;
  }

  return { tools: preExecTools, data };
}
