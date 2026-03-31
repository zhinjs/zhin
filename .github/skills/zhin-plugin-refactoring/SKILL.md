---
name: zhin-plugin-refactoring
description: 'Refactor existing Zhin.js plugins into a cleaner standard structure. Use when asked to reorganize plugin files, split commands or services, migrate a messy plugin to standard layout, reduce coupling, clean lifecycle logic, or standardize plugin structure without changing behavior. 适用于已有 Zhin 插件重构、结构整理、职责拆分与标准化迁移。'
argument-hint: 'Describe the plugin to refactor, current problems such as mixed responsibilities or duplicated logic, and the target outcome such as split modules, cleaner lifecycle, or standard layout.'
user-invocable: true
---

# Zhin 插件重构工作流

把已经存在但结构混乱的 Zhin 插件，整理成更清晰、更符合仓库约定的结构，同时尽量不改变现有行为。

配套参考按需加载：

- [重构决策参考](./references/refactor-decision-guide.md)
- [重构迁移清单](./references/refactor-migration-checklist.md)
- [重构前后对照示例](./references/refactor-before-after-example.md)
- [目标结构草图](./assets/refactor-target-layout.md)

## 何时使用

- 一个插件把命令、数据库、路由、页面逻辑都堆在一个文件里
- 需要拆分 `commands/`、`services/`、`models/`、`client/`
- 想减少重复逻辑、生命周期混乱、Context 使用散乱
- 想把旧插件迁移到更标准的 Zhin 插件结构
- 用户明确要求“重构插件”“整理插件结构”“拆模块但别改行为”

## 不适用场景

- 从零新建插件：改用 `zhin-plugin-standard-development`
- 平台接入、Bot 生命周期、消息格式转换：改用适配器工作流
- 主要是页面视觉和交互优化：改用前端优化工作流

## 完成标准

- 行为保持不变或仅做用户明确允许的最小改动
- 目录和职责边界更清晰
- 生命周期和资源清理更稳定
- 配置、模型、Context、路由、页面入口不再散落在无关模块中
- 至少完成关键路径验证

## 重构步骤

### 第 1 步：冻结当前行为

先识别：

- 这个插件当前对外有哪些命令、路由、页面、事件或周期任务
- 哪些行为是用户可见的，不能随意改
- 哪些问题是结构问题，哪些是功能缺陷

不要一上来就拆文件。先把当前行为面画清楚。

### 第 2 步：盘点能力与职责

把现有代码按能力分类：

- 命令
- 中间件
- 事件监听
- 定时任务
- 组件
- AI 工具
- 数据模型
- 数据访问逻辑
- HTTP / Web 集成
- 配置声明

如果不知道怎么分类，先看 [重构决策参考](./references/refactor-decision-guide.md)。

如果你需要一个“单文件旧插件如何拆成标准结构”的直观参考，直接看 [重构前后对照示例](./references/refactor-before-after-example.md)。

### 第 3 步：确定目标结构

根据当前复杂度选择目标结构，而不是追求最完整目录：

- 小型插件：保留单文件，最多轻量抽服务
- 中型插件：拆 `commands/`、`services/`、`models/`
- 含控制台页面：再拆 `client/`
- 含 AI 工具：补 `tools/`

目标结构可直接参考 [目标结构草图](./assets/refactor-target-layout.md)。

### 第 4 步：按稳定边界迁移

迁移优先顺序：

1. 配置与 Schema
2. 模型定义
3. 数据访问与共享服务
4. 命令与中间件
5. 事件、定时任务、AI 工具
6. Router 与 Web 页面入口

优先移动低耦合代码，再移动依赖较多的装配代码。

如果你不确定某段旧代码该落到哪个目录，先对照 [重构前后对照示例](./references/refactor-before-after-example.md) 再迁移。

### 第 5 步：收口到入口文件

重构后的入口文件应只负责：

- `usePlugin()`
- `declareConfig()`
- 装配子模块
- `useContext()` 注入依赖

不要把业务细节继续留在入口文件里。

### 第 6 步：校验生命周期与清理

检查以下问题：

- 监听器是否在销毁时可清理
- 定时任务是否通过 `addCron()` 管理
- 路由与 Web 入口是否有对应释放路径
- 数据库逻辑是否只在 `database` Context 就绪后挂载

### 第 7 步：验证行为未回退

至少验证：

- 命令还能正常触发
- 路由或页面入口还能注册
- 定时任务和事件没有丢失
- 关键配置读取仍然正确

## 输出要求

最终输出应包含：

1. 当前结构问题：混乱点和耦合点是什么
2. 目标结构：准备拆成什么样
3. 迁移策略：先迁什么，后迁什么
4. 已完成改动：哪些模块已重构
5. 验证结果：哪些路径已验证
6. 风险说明：还有哪些行为敏感点