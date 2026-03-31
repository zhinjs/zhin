---
name: zhin-audit
description: 'Audit Zhin.js monorepo for security vulnerabilities, performance bottlenecks, and architecture issues. Use when asked to "audit code", "check security", "find performance issues", "review architecture", "scan for vulnerabilities", "check memory leaks", or "review code quality".'
---

# Zhin.js 代码审计技能

对 Zhin.js monorepo 进行安全漏洞、性能瓶颈和架构问题的系统化审计。

## 适用场景

- 审查新增/修改的代码是否引入安全风险
- 检测内存泄漏、性能回退
- 验证分层架构约束和依赖方向
- PR 代码审查的专项检查
- 版本发布前的全面审计

## 审计流程

### 第 1 步：确定审计范围

根据用户请求决定审计范围和深度：

| 范围 | 目标目录 | 触发词 |
|------|----------|--------|
| 全面审计 | `packages/`, `plugins/`, `basic/` | "全面审计", "全量检查" |
| 安全专项 | `packages/core/`, `packages/agent/`, `plugins/services/http/`, `packages/satori/` | "安全", "漏洞", "XSS", "注入" |
| 性能专项 | `packages/core/src/plugin.ts`, `packages/core/src/built/`, `packages/core/src/adapter.ts` | "性能", "内存", "泄漏", "慢" |
| 架构专项 | `packages/*/package.json`, `packages/*/src/index.ts` | "架构", "依赖", "分层", "耦合" |
| 变更审计 | `git diff` 涉及的文件 | "审查变更", "PR 审查" |

### 第 2 步：运行安全检查

按 [安全检查清单](./references/security-checklist.md) 逐项执行。

**关键检查项**（按严重程度排序）：

1. **代码执行风险 [严重]**
   - 搜索 `eval`, `Function(`, `new Function`, `vm.runIn`
   - 搜索 `child_process`, `exec(`, `execSync`, `spawn`
   - 检查 `packages/agent/src/builtin-tools.ts` 中 bash 命令安全策略
   - 验证 `packages/agent/src/file-policy.ts` 文件访问控制覆盖率

2. **注入攻击 [严重]**
   - SQL 注入：检查 `basic/database/src/` 中参数化查询
   - 命令注入：检查所有 `exec()` 调用的参数转义
   - XSS：检查 `packages/satori/src/` HTML 渲染中的输入转义

3. **认证与授权 [高]**
   - 检查 `plugins/services/http/src/index.ts` Token 校验逻辑
   - 验证 Bearer token 是否使用 `crypto.timingSafeEqual` 比较
   - 确认 query 参数 token 不会泄漏到日志
   - 检查 `/pub/` 公共路径配置是否合理

4. **敏感信息泄漏 [高]**
   - 搜索硬编码的 token、password、secret
   - 检查日志输出是否包含敏感信息
   - 验证错误响应不暴露内部实现细节

5. **路径遍历 [中]**
   - 检查文件操作是否验证路径边界
   - 验证 `packages/agent/src/file-policy.ts` 的 `SENSITIVE_FILENAMES` 列表完整性

### 第 3 步：运行性能检查

按 [性能检查清单](./references/performance-checklist.md) 逐项执行。

**关键检查项**：

1. **内存泄漏 [高]**
   - 事件监听器：所有 `on()`/`addMiddleware()` 是否在 `#disposables` 中注册清理
   - 定时器：所有 `setInterval`/`setTimeout` 是否有对应 `clearInterval`/`clearTimeout`
   - 文件监听：`fs.watch()` 是否在插件卸载时关闭
   - WeakMap/WeakRef：大量对象引用是否使用弱引用

2. **无界集合 [高]**
   - `Map`/`Set` 是否只增不减：`#tools`, `#middlewares`, `#featureContributions`
   - 缓存是否有 TTL 或 LRU 策略
   - 插件 `children` 数组是否在 `stop()` 时清空

3. **热路径效率 [中]**
   - 消息分发路径：`extractText()` 重复调用
   - 命令查找：是否使用线性搜索
   - 序列化/反序列化开销

4. **异步错误处理 [中]**
   - `void` 前缀的 Promise 调用是否有 `.catch()` 兜底
   - 未处理的 Promise rejection
   - `async` 函数中缺失的 `try/catch`

### 第 4 步：运行架构检查

按 [架构检查清单](./references/architecture-checklist.md) 逐项执行。

**关键检查项**：

1. **分层违规 [高]**
   - 依赖方向必须单向：`basic/ → kernel → ai → core → agent → zhin`
   - `kernel` 和 `ai` **禁止**依赖 IM 概念（Adapter, Bot, Message）
   - 检查 `package.json` 中 `dependencies` 是否存在反向依赖

2. **AsyncLocalStorage 安全 [高]**
   - `usePlugin()` 只能在模块顶层或同步上下文调用
   - `setTimeout`、`Promise.all` 等异步边界是否丢失上下文
   - 出站 `outboundReplyAls` 上下文传播完整性

3. **Plugin 生命周期 [中]**
   - `start()` 部分失败时是否回滚已挂载的 Context
   - `stop()` 是否按逆序卸载资源
   - 循环依赖检测：`provide()` 之间是否存在相互引用

4. **事件系统 [中]**
   - `emit` / `dispatch` / `broadcast` 使用场景是否正确
   - 是否存在事件命名冲突
   - 监听器注册是否过于宽泛

### 第 5 步：生成报告

按以下格式输出审计报告：

```markdown
# Zhin.js 审计报告

## 概要
- 审计范围：[全面/安全/性能/架构]
- 审计时间：[日期]
- 发现问题：严重 X / 高 X / 中 X / 低 X

## 严重问题
### [编号] [标题]
- **类别**：安全/性能/架构
- **文件**：`path/to/file.ts#L行号`
- **描述**：问题详述
- **影响**：可能造成的后果
- **修复建议**：具体代码修改方案

## 高危问题
...

## 中危问题
...

## 优化建议
...
```

## Zhin 特有注意事项

以下是 Zhin.js 框架独有的、通用审计工具不会检测到的问题：

1. **Tool Service 双注册**：`Plugin.#tools` 和 `ToolService` 可能不一致
2. **Command Service 静默失败**：中间件在 CommandService 未注册时静默跳过
3. **适配器消息格式化**：`$formatMessage` 必须包含 `$recall` 方法
4. **出站消息链一致性**：所有发送必须经过 `renderSendMessage → before.sendMessage → bot.$sendMessage`
5. **热重载缓存失效**：`import(?t=...)` 防缓存 URL 和 `require.cache` 清理

## 常用搜索命令

```bash
# 安全：查找代码执行风险
grep -rn "eval\|Function(\|exec(\|execSync\|spawn(" packages/ plugins/ basic/ --include="*.ts"

# 安全：查找硬编码凭据
grep -rn "token\|password\|secret\|apiKey" packages/ plugins/ --include="*.ts" | grep -v "\.d\.ts" | grep -v "type\|interface\|declare"

# 性能：查找未清理的监听器
grep -rn "setInterval\|setTimeout\|\.on(" packages/core/src/ --include="*.ts"

# 架构：检查反向依赖
cat packages/kernel/package.json | grep -A 20 '"dependencies"'
cat packages/ai/package.json | grep -A 20 '"dependencies"'
```
