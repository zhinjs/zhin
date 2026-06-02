---
name: plugin-quality
description: "审查和改进 Zhin.js 插件质量。Use when asked to review plugin code, check code quality, audit plugin structure, refactor plugin, or improve plugin before publishing. 引导检查插件的结构规范性、代码健壮性、性能和安全性。"
keywords:
  - 代码审查
  - 质量检查
  - review
  - 审计
  - 重构
  - refactor
  - 代码规范
  - lint
  - quality
tags:
  - development
  - quality
  - review
---

# Zhin 插件质量审查

对 Zhin.js 插件进行全面质量审查，检查结构规范性、代码风格、性能问题和安全隐患，确保达到发布标准。

## 适用场景

- 用户说"检查一下插件质量"、"审查代码"、"发布前看看有没有问题"
- 插件开发完成，准备发布前的质量把关
- 重构现有插件使其更规范

## 审查维度

### 1. 结构规范性

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| usePlugin() 位置 | 模块顶层调用 | 🔴 严重 |
| 导入路径 | TS 文件间使用 `.js` 扩展名 | 🔴 严重 |
| 框架导入 | 统一从 `zhin.js` 导入 | 🟡 中等 |
| 入口职责 | index.ts 只做装配，不堆业务 | 🟡 中等 |
| 目录布局 | 命令/中间件/服务分目录（多功能时） | 🟢 建议 |
| package.json | type:module、exports、files | 🔴 严重 |

**常见错误：**

```typescript
// ❌ usePlugin 在 async 内调用
async function setup() {
  const plugin = usePlugin()  // 上下文可能丢失
}

// ✅ 模块顶层
const plugin = usePlugin()

// ❌ 缺少 .js 扩展名
import { foo } from './bar'

// ✅ 正确
import { foo } from './bar.js'

// ❌ 从内部包导入
import { Plugin } from '@zhin.js/core'

// ✅ 统一导入
import { Plugin } from 'zhin.js'
```

### 2. 生命周期管理

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| useContext 清理 | 回调返回清理函数 | 🔴 严重 |
| 定时器清理 | setInterval/setTimeout 有 clearInterval | 🔴 严重 |
| 事件监听清理 | 外部 EventEmitter 监听有移除 | 🟡 中等 |
| 连接清理 | WebSocket/HTTP 连接有断开逻辑 | 🔴 严重 |

**常见泄漏模式：**

```typescript
// ❌ 没有清理
useContext('database', (db) => {
  const timer = setInterval(() => { /* ... */ }, 1000)
  // 插件卸载后 timer 仍在运行！
})

// ✅ 返回清理函数
useContext('database', (db) => {
  const timer = setInterval(() => { /* ... */ }, 1000)
  return () => clearInterval(timer)
})
```

### 3. 类型安全

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| 无 `any` 滥用 | 除必要的类型断言外不使用 any | 🟡 中等 |
| 类型声明完整 | Context 扩展、命令参数有类型 | 🟡 中等 |
| 严格模式 | tsconfig.json 开启 strict | 🟢 建议 |

### 4. 安全性

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| 无硬编码凭据 | token/password/secret 不在源码中 | 🔴 严重 |
| 用户输入校验 | 命令参数、API 入参有校验 | 🟡 中等 |
| SQL 注入防护 | 使用参数化查询 | 🔴 严重 |
| 路径遍历防护 | 文件操作验证路径 | 🔴 严重 |
| eval/Function | 不使用 eval 或 new Function | 🔴 严重 |

### 5. 性能

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| 无阻塞操作 | 不在中间件中执行同步重操作 | 🟡 中等 |
| 合理缓存 | 高频查询结果有缓存策略 | 🟢 建议 |
| 内存泄漏 | WeakMap/WeakRef 用于大量对象引用 | 🟡 中等 |
| 批量操作 | 数据库操作避免 N+1 查询 | 🟢 建议 |

### 6. 文档与测试

**检查项：**

| 项目 | 要求 | 严重程度 |
|------|------|----------|
| README 完整 | 安装、配置、使用、命令列表 | 🔴 严重 |
| CHANGELOG | 版本变更记录 | 🟡 中等 |
| 测试存在 | 核心功能有测试 | 🔴 严重 |
| 覆盖率 | ≥ 60% statements | 🟡 中等 |

## 审查流程

### 第 1 步：快速扫描

```bash
# 检查结构
ls -la src/ tests/ client/ skills/

# 检查类型
pnpm build 2>&1 | grep error

# 检查测试
pnpm test

# 检查安全关键词
grep -rn "eval\|Function(\|exec(\|execSync\|password\|secret\|token" src/
```

### 第 2 步：逐文件审查

对每个源文件检查：
1. 导入路径是否正确
2. usePlugin/useContext 使用是否正确
3. 资源是否有清理路径
4. 用户输入是否有校验

### 第 3 步：输出审查报告

格式：

```
## 插件质量审查报告

### 概要
- 插件名：xxx
- 审查文件数：N
- 问题总数：X（严重 A / 中等 B / 建议 C）

### 🔴 严重问题
1. [文件:行号] 问题描述 → 建议修复方式

### 🟡 中等问题
1. [文件:行号] 问题描述 → 建议修复方式

### 🟢 改进建议
1. [文件:行号] 建议内容

### 发布就绪度
- ✅/❌ 结构规范
- ✅/❌ 生命周期安全
- ✅/❌ 类型完整
- ✅/❌ 安全无风险
- ✅/❌ 测试通过
- ✅/❌ 文档完整
```

## 检查清单（总结）

- [ ] usePlugin() 在模块顶层
- [ ] 导入路径使用 .js 扩展名
- [ ] 所有 useContext 回调返回清理函数
- [ ] 无硬编码凭据
- [ ] 无 eval/Function 使用
- [ ] 用户输入有校验
- [ ] tsc 编译无错误
- [ ] 测试全部通过
- [ ] 覆盖率 ≥ 60%
- [ ] README 完整
- [ ] CHANGELOG 更新
