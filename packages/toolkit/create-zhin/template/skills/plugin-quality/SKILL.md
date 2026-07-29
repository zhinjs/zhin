---
name: plugin-quality
description: "审查和改进 Zhin.js 插件质量（Plugin Runtime）。Use when asked to review plugin code, audit structure, or improve before publishing. 检查 definePlugin、约定目录、发送链与安全。"
keywords:
  - 代码审查
  - 质量检查
  - review
  - 审计
  - 重构
  - lint
  - quality
  - definePlugin
tags:
  - development
  - quality
  - review
---

# Zhin 插件质量审查（Plugin Runtime）

对照 **Plugin Runtime** 审查插件：结构、约定目录、依赖方向、发送链与安全。发现仍用 `usePlugin` / `MessageCommand` 的新代码应标为缺陷并迁移。

## 适用场景

- 「检查插件质量」「审查代码」「发布前看看有没有问题」
- 重构现有插件使其符合 Runtime

## 审查维度

### 1. 结构规范性

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| 入口 | `plugin.ts` default-export `definePlugin()` | 🔴 严重 |
| manifest | `package.json#zhin`（protocol、entry、features） | 🔴 严重 |
| 能力放置 | 约定目录 + default export；非业务堆在 `plugin.ts` | 🔴 严重 |
| 旧 API | 新代码无 `usePlugin` / `getPlugin` / `MessageCommand` | 🔴 严重 |
| 导入路径 | 相对导入带 `.js` | 🔴 严重 |
| Feature 依赖 | 用到的能力已在 `zhin.features` 声明 | 🟡 中等 |
| 配置 | 自有字段在 `schema.json`，经 `context.config` 读取 | 🟡 中等 |

**常见错误：**

```typescript
// ❌ 经典插件 API（Runtime 下不工作）
import { usePlugin, MessageCommand } from 'zhin.js'
const plugin = usePlugin()
plugin.addCommand(new MessageCommand('hi').action(() => 'hi'))

// ✅ Runtime
import { definePlugin } from 'zhin.js/plugin-runtime'
export default definePlugin({ name: 'my-plugin', setup() {} })
// + commands/hi.ts → defineCommand(...)
```

### 2. 生命周期与资源

- 清理走 `context.lifecycle.add` 或 `setup` 返回 disposer
- 共享连接/DB 用 `context.resources.provide`，禁止裸模块级单例（优先 `createGenerationStore`）
- Host token 先 `has` 再 `use`（精简安装下可选）

### 3. 发送与安全

- 出站不绕过 `Message.$reply` / `Adapter.sendMessage` → `before.sendMessage`
- 密钥只走环境变量 / `${VAR}` 配置引用
- AI 工具副作用边界清晰；危险操作有策略/确认

### 4. 测试与文档

- 至少覆盖核心 `execute` 路径
- README 写明命令触发方式与 Feature 依赖
- 带 `agent/` 的包检查 `files` / `prepublishOnly`（`pnpm check:plugin-agent-publish`）

## 审查流程

1. 读 `package.json#zhin` + `plugin.ts`
2. 扫 `commands/` / `tools/` / `middlewares/` 是否 default export 正确 API
3. ripgrep：`usePlugin|MessageCommand|getPlugin|bootstrapNode`
4. 跑 `pnpm --filter <pkg> test`（及需要的 harness）
5. 输出问题清单（严重度 + 建议修复）

## 输出格式

```markdown
## 结论
- 是否可发布：是 / 否

## 问题
| 严重度 | 位置 | 问题 | 建议 |
|--------|------|------|------|
| 🔴 | ... | ... | ... |

## 已通过
- definePlugin 入口 / 约定目录 / 发送链 …
```

## 迁移

旧插件迁 Runtime：`.github/skills/migrate-zhin-plugin-runtime`。
