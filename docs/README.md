
# Zhin Bot Framework 文档

欢迎使用 Zhin.js 文档系统！本项目专注于插件化、热重载和多平台生态，支持 TypeScript 全量类型。

## 文档说明

本系统文档涵盖：
- 快速入门与项目结构
- API 参考与类型定义
- 插件/适配器开发指南
- 最佳实践与示例

### 开箱即用
- 控制台适配器、HTTP 服务、Web 控制台、SQLite 数据库

### 可选扩展（需手动安装）
- Telegram、Discord、QQ、KOOK、OneBot v11、MySQL、PostgreSQL 等


## 文档结构

- [入门指南](./guide/quick-start.md)
- [API 参考](./api/index.md)
- [插件开发](./plugin/index.md)
- [适配器开发](./adapter/index.md)
- [最佳实践](./guide/best-practices.md)
- [示例](./examples/index.md)

## 快速开始

1. 创建新项目：
```bash
pnpm create zhin my-bot
```

2. 进入项目目录：
```bash
cd my-bot
```

3. 安装依赖：
```bash
pnpm install
```

4. 开发模式启动：
```bash
pnpm dev
```

## 文档导航

### 入门指南
- [快速开始](./guide/quick-start.md)
- [项目结构](./guide/project-structure.md)
- [配置说明](./guide/configuration.md)
- [基本概念](./guide/concepts.md)
- [最佳实践](./guide/best-practices.md)

### API参考
- [核心API](./api/core.md)
- [插件API](./api/plugin.md)
- [适配器API](./api/adapter.md)
- [事件系统](./api/events.md)
- [类型定义](./api/types.md)

### 插件开发
- [插件开发指南](./plugin/development.md)
- [插件生命周期](./plugin/lifecycle.md)
- [上下文系统](./plugin/context.md)
- [中间件系统](./plugin/middleware.md)
- [定时任务](./plugin/cron.md)

### 适配器开发
- [适配器开发指南](./adapter/development.md)
- [Bot接口实现](./adapter/bot-interface.md)
- [消息处理](./adapter/message-handling.md)
- [事件处理](./adapter/event-handling.md)

### 示例
- [基础示例](./examples/basic-usage.md)
- [高级示例](./examples/advanced-usage.md)
- [真实世界示例](./examples/real-world.md)

## 贡献指南

我们欢迎所有形式的贡献，包括但不限于：
- 文档改进
- Bug修复
- 功能增强
- 示例贡献

请参考[贡献指南](./contributing.md)了解如何参与项目贡献。

## 许可证

MIT License
