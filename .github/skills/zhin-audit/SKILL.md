---
name: zhin-audit
description: 'Audit Zhin.js changes for security, performance, lifecycle, and architecture regressions. Use for release review, security review, performance review, architecture review, or change-based code audit.'
argument-hint: 'Describe the scope: changed files, package, security, performance, architecture, or full release.'
user-invocable: true
---

# Zhin.js 代码审计

先建立当前分支事实，再给结论。仓库的 `AGENTS.md`、`docs/concepts/architecture.md`、目标包
`package.json` 和现有 harness 是契约来源；不要从旧类名或旧目录推断实现。

## 1. 固定审计基线

1. 读取目标 diff、相关测试和最近的包 README。
2. 明确比较基线与未提交改动；变更审计默认看完整 diff，不只看最后一个 commit。
3. 先跑与变更对应的最小门禁，再读失败调用链。
4. 报告只写有证据的问题：给出触发条件、影响、文件和最小修复方向。

## 2. 按范围检查

- 安全：按 [安全清单](./references/security-checklist.md) 检查 Tool 策略、文件/网络/Shell 边界、Host 鉴权、凭据和输入验证。
- 性能与生命周期：按 [性能清单](./references/performance-checklist.md) 检查 generation 回滚、listener、timer、socket、缓存和外部请求。
- 架构：按 [架构清单](./references/architecture-checklist.md) 检查依赖方向、Resource ownership、Feature 约定目录、Adapter 与消息链。

根据 diff 选择门禁，常用入口：

```bash
pnpm check:architecture
pnpm check:domain-module-boundaries
pnpm check:harness-paths
pnpm check:adapter-endpoint-boundaries
pnpm check:no-removed-plugin-api
pnpm check:runtime-config-boundaries
pnpm check:agent-tool-authoring-boundaries
pnpm check:skill-authoring-boundaries
pnpm check:agent-authoring-boundaries
pnpm check:hook-authoring-boundaries
pnpm check:plugin-capability-publish
```

包内变更先跑 `pnpm --filter <pkg> test` / `build`。发布前再根据影响面扩大到
`pnpm check:all`；不要用静态搜索代替测试，也不要把环境故障写成代码缺陷。

## 3. Zhin 当前不变量

- Plugin Runtime：`plugin.ts` default-export `definePlugin()`；能力位于命名目录的
  `index.ts(x)`。已移除的 `usePlugin/getPlugin` 不得回归。
- Resource：setup 使用 `context.resources`；能力执行上下文直接 `context.use(token)`。
  generation 状态不能退回模块级 latest-value 单例。
- Tool：声明字段是 `requiresApproval: never | on-risk | once | always`；权限、审批与
  Shell/文件/网络专用策略是不同层。builtin 安全检查统一进入
  `packages/im/agent/src/security/policy-facade.ts` 的 `runToolPolicies`。
- Adapter：优先 `defineAdapter({ capabilities, create })` 的
  `{ client, connect, activate?, send }` 契约；WS/SSE 生命周期用 `createEndpointLifecycle`。
- 出站：`Message.$reply` / `Adapter.sendMessage` 必须经过
  `renderSendMessage → before.sendMessage → AdapterIndex/Endpoint`。
- Console 页面：`pages/<name>/index.tsx` 默认导出组件并命名导出 `meta = definePage(...)`。

## 4. 报告格式

问题按 P0–P3 排序。每项包含：触发条件、实际影响、证据位置、建议修复。无问题时明确说明已覆盖
范围与未验证边界。不要粘贴 token、`.env`、用户 ID 或完整敏感请求。
