import type { AIService } from '../service.js';
import type { ResolvedAgentBinding } from '../config/types.js';
/**
 * 主 ZhinAgent 绑定下对子 agent 结果做轻量摘要后回复用户。
 */
export async function summarizeSubagentResultForUser(
  ai: AIService,
  subagentName: string,
  userRequest: string,
  subagentResult: string,
): Promise<string> {
  const zhinBinding = ai.getBindingRegistry().requireZhinBinding();
  const provider = ai.getProvider(zhinBinding.providerAlias);
  const model = zhinBinding.model || provider.models[0];
  const system = `你是 Zhin 主助手。子 agent「${subagentName}」已完成任务，请将结果整理成面向用户的简洁回复（中文），保留关键事实，不要暴露内部工具名或 JSON。`;
  const user = `用户请求：\n${userRequest}\n\n子 agent 原始输出：\n${subagentResult}`;
  try {
    const text = await ai.ask(user, {
      provider: zhinBinding.providerAlias,
      model,
      systemPrompt: system,
      temperature: 0.3,
    });
    return text.trim() || subagentResult;
  } catch {
    return subagentResult;
  }
}
