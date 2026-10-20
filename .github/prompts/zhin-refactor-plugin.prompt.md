---
name: "Zhin Refactor Plugin"
description: "Refactor an existing Zhin.js plugin into a cleaner standard structure without unnecessary behavior changes. Use for messy plugin files, mixed responsibilities, lifecycle cleanup, or module splitting."
argument-hint: "Describe the plugin to refactor and the structural problems you want fixed."
agent: "plugin-developer"
---
Load and follow the `zhin-plugin-refactoring` skill.

Refactor the requested Zhin.js plugin toward a cleaner standard structure.

## Requirements

- Freeze current behavior before moving code
- Identify responsibilities such as commands, middleware, events, cron jobs, models, services, tools, router, and client pages
- Choose a target structure that matches the plugin's real complexity
- Minimize behavior changes; refactoring is the primary goal
- Use the refactoring references and before/after example when deciding module boundaries
- Validate that key commands, routes, scheduled jobs, and configuration paths still work after changes

## Output Format

输出必须包含以下段落，不能省略：

1. **当前问题**：混乱点和耦合点是什么，哪些职责混在了不该在的位置
2. **目标结构**：选了哪种目标骨架，与当前复杂度是否匹配
3. **迁移策略**：按什么顺序迁移（配置 → 模型 → 服务 → 命令 → 事件 → Web）
4. **已完成改动**：哪些模块已重构，入口文件是否已收口
5. **行为验证**：关键命令、路由、定时任务、配置读取是否验证通过
6. **风险说明**：仍需注意的行为敏感点或未覆盖的验证