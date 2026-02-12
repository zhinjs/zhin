# Zhin.js Packages

核心包目录，包含框架运行所必需的模块。

## 包列表

| 包名 | 路径 | 说明 |
|------|------|------|
| [`zhin.js`](./zhin/) | `packages/zhin` | 主入口包，重新导出 `@zhin.js/core` 全部 API |
| [`@zhin.js/core`](./core/) | `packages/core` | 核心框架：Plugin、Feature、Adapter、AI、MessageDispatcher |
| [`@zhin.js/client`](./client/) | `packages/client` | Web 控制台 React 客户端 |
| [`@zhin.js/satori`](./satori/) | `packages/satori` | HTML/CSS → SVG/PNG 渲染引擎 |
| [`create-zhin-app`](./create-zhin/) | `packages/create-zhin` | 项目脚手架 CLI |

## 架构概览

```
zhin.js (主入口)
  └── @zhin.js/core (核心框架)
        ├── Plugin 插件系统
        ├── Feature 架构 (Command, Tool, Skill, Cron, Database, Component, Config, Permission)
        ├── Adapter 适配器抽象
        ├── MessageDispatcher 消息路由
        └── AI 模块 (ZhinAgent, Provider, SessionManager, ConversationMemory ...)
```

## 基础层依赖

核心包依赖 `basic/` 目录下的基础模块：

| 包名 | 路径 | 说明 |
|------|------|------|
| `@zhin.js/cli` | `basic/cli` | 命令行工具（dev、start、new、build、pub） |
| `@zhin.js/database` | `basic/database` | 数据库抽象层（SQLite、MySQL、MongoDB 等） |
| `@zhin.js/logger` | `basic/logger` | 日志系统 |
| `@zhin.js/schema` | `basic/schema` | Schema 校验与序列化 |
