// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// AI 工具按目录发现，一个文件一个工具，default export：
//   my-plugin/
//     tools/plugin-health.ts        ← 包顶层工具（@zhin.js/tool）
//     agent/tools/run-code.ts       ← agent/ 授权面工具（@zhin.js/agent）
//     agent/skills/<name>.md        ← Skill：标准 SKILL.md（frontmatter + 正文）
//     agents/<name>.agent.md        ← Agent 预设：frontmatter + 正文作为 systemPrompt
//
// 注意：插件包禁止**顶层 skills/**，必须用 `agent/skills/*.md`（check:no-package-skills）。
import { defineAgentTool } from '@zhin.js/tool';

interface HealthInput {
  verbose?: boolean;
}

export default defineAgentTool<HealthInput>({
  description: 'Get plugin health status',
  // JSON Schema；字段须与 execute 实际读取的入参一致（check:agent-tool-schema 会校验）
  inputSchema: {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description: 'Include per-subsystem detail',
      },
    },
  },
  // 'never' | 'on-risk' | 'always'，缺省为 'on-risk'。
  // 有副作用/高风险的工具不要降级成 'never'。
  approval: 'never',
  // 入参是第一个位置参数；第二个参数是 CapabilityContext（含 config）。
  execute(input, context) {
    return {
      ok: true,
      verbose: input?.verbose ?? false,
      timestamp: new Date().toISOString(),
    };
  },
});
