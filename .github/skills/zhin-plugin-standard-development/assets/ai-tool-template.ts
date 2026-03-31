// @ts-nocheck
import { ZhinTool, usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

// ====== Tool: 单个 AI 可调用能力 ======

const healthTool = new ZhinTool('plugin_health')
  .desc('Get plugin health status')
  .tag('plugin', 'health')
  .execute(async () => {
    return {
      ok: true,
      timestamp: new Date().toISOString(),
    }
  })

addTool(healthTool.toTool())

// ====== Skill: 以标准 SKILL.md 文件提供（按需加载） ======
// 将 SKILL.md 放在 skills/<name>/ 下，框架自动发现
// 目录结构：
//   skills/
//     plugin-monitoring/
//       SKILL.md          ← frontmatter: name, description, keywords, tools, always
//

// ====== Agent 预设: 以标准 *.agent.md 文件提供 ======
// 将 agent.md 放在 agents/ 下，框架自动发现
// 目录结构：
//   agents/
//     ops-assistant.agent.md   ← frontmatter: name, description, tools, model 等
//                                 body 作为 systemPrompt