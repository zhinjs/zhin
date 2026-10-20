import type { AgentTool } from '@zhin.js/ai';

export async function applyToolToModelOutput(
  tool: Pick<AgentTool, 'toModelOutput'>,
  raw: unknown,
  args: Record<string, unknown>,
): Promise<string> {
  if (!tool.toModelOutput) {
    return typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
  }
  return tool.toModelOutput({ result: raw, args });
}
