import { defineAgentPromptSection } from '@zhin.js/agent';

/**
 * full-bot 自定义提示词节点示例。
 * 放置在 `agent/prompt-sections/` 目录中，Agent 初始化时自动发现并注册。
 */
export default defineAgentPromptSection({
  id: 'full-bot:custom-rules',
  title: 'Full Bot Custom Rules',
  content: `You are running in the full-bot example of Zhin.js.
This section demonstrates how plugins can contribute custom prompt sections.
Follow these additional guidelines:
- Always be concise and helpful.
- Prefer structured output when presenting lists or tables.`,
  priority: 70,
  truncatable: true,
  maxChars: 1000,
});
