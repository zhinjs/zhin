# test-bot

Zhin.js 框架的测试机器人项目，用于演示和测试框架功能。

## 功能

- 多适配器演示（ICQQ、Sandbox 等）
- 插件系统演示
- AI 工具和技能演示
- 命令和中间件演示
- JSX 组件渲染演示

## 项目结构

```
test-bot/
├── data/                # 数据目录
├── src/
│   └── plugins/         # 插件目录
│       ├── test-plugin.ts   # 综合测试插件
│       ├── test-jsx.tsx     # JSX 组件测试
│       └── ...              # 其他测试插件
├── package.json
├── tsconfig.json
└── zhin.config.yml      # 配置文件
```

## 测试插件功能

### 命令系统

测试插件注册了多种命令，演示参数解析、权限控制等功能。

### AI 工具

演示了 Tool 注册和 Skill 声明，让 AI 智能体调用工具。

### 消息处理

演示了以下功能：
- 中间件系统
- 消息拦截与修改
- 消息回复

### JSX 组件

演示了 JSX/TSX 组件在消息中的渲染。

## 运行

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 生产模式
pnpm start
```

## 许可证

MIT License
