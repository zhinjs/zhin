# Zhin Bot Framework Packages

Zhin框架的核心包集合。

## 包说明

### zhin.js

主包，重导出`@zhin.js/core`的所有功能。这是用户使用框架时应该安装的包。

```bash
pnpm add zhin.js
```

### @zhin.js/core

框架的核心实现，提供：
- 插件系统
- 适配器管理
- 事件系统
- 消息处理
- 配置管理
- 热更新支持

### @zhin.js/hmr

热模块替换系统的实现，提供：
- 文件监听
- 模块加载
- 依赖管理
- 性能监控
- 重载管理

### @zhin.js/types

框架的类型定义包，提供：
- 全局上下文类型
- 消息类型
- 配置类型
- 插件类型
- 适配器类型

### @zhin.js/cli

命令行工具，提供：
- 项目创建
- 开发服务器
- 构建工具
- 进程管理

### create-zhin

项目创建工具，`@zhin.js/cli`的便捷包装。

```bash
pnpm create zhin my-bot
```

## 开发指南

1. 安装依赖：
```bash
pnpm install
```

2. 构建所有包：
```bash
pnpm build
```

3. 运行测试：
```bash
pnpm test
```

4. 开发模式：
```bash
pnpm dev
```

## 许可证

MIT License
