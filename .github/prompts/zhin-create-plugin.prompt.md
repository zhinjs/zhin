---
name: "Zhin Create Plugin"
description: "Create or extend a Zhin.js plugin with the standard workflow. Use for new plugins, adding commands, middleware, events, cron jobs, components, Contexts, database, router, web console pages, or AI tools."
argument-hint: "Describe the plugin goal and required capabilities."
agent: "plugin-developer"
---
Load and follow the `zhin-plugin-standard-development` skill.

Implement the requested Zhin.js plugin work using the repository's standard plugin workflow.

## Requirements

- First classify the plugin capability type (commands, middleware, events, cron, components, AI tools, services, database, web) and choose an appropriate structure
- Use the skill assets and references when needed instead of inventing ad hoc layouts
- Prefer minimal viable structure before expanding directories
- Keep implementation aligned with repository conventions, especially `.js` import extensions and `declareConfig()` usage
- When relevant, include commands, middleware, events, components, cron jobs, Contexts, database, router, web console integration, or AI tools
- Validate the critical path after changes

## Output Format

输出必须包含以下段落，不能省略：

1. **任务类型**：属于哪类插件能力（命令/中间件/事件/定时/组件/AI 工具/服务/数据/Web），为什么
2. **结构选择**：选了哪种目录骨架，判断依据是什么
3. **实现内容**：创建或修改了哪些文件，核心逻辑说明
4. **约定检查**：`.js` 导入、`declareConfig()`、`usePlugin()` 作用域、生命周期清理是否合规
5. **验证结果**：已执行的检查（类型/构建/测试/关键路径）及结果
6. **残余风险**：仅与当前改动直接相关的风险