# test-bot（厨房水槽 · Advanced）

> **这不是默认入门模板。** 新用户请使用 [`../minimal-bot`](../minimal-bot/)（Stable 黄金路径）。  
> 能力验收见 [ACCEPTANCE.md](./ACCEPTANCE.md)（Stable vs Advanced）。

Zhin.js 维护者用**全功能**机器人：多适配器、toolSearch、MCP、多 bot 同开，用于回归与 Advanced 验收。

## 维护者运行手册

### Monorepo 前置条件

在**仓库根目录**完成一次全量准备（test-bot 依赖 workspace 包，不可单独 `npm install` 后裸跑）：

```bash
cd /path/to/zhin
pnpm install
pnpm build   # 或至少构建 logger / cli / core / agent / zhin / 本示例引用的 adapters
```

- Node.js `^20.19.0 || >=22.12.0`，pnpm 9+
- 复制 `examples/test-bot/.env.example` → `.env`，按 `zhin.config.yml` 填各适配器凭据

### 启动与验收

```bash
cd examples/test-bot
pnpm dev      # 开发模式（热重载）
pnpm start    # 生产模式
```

| 文档 | 用途 |
|------|------|
| [ACCEPTANCE.md](./ACCEPTANCE.md) | Stable / Advanced 验收清单与 `pnpm check:stable` 命令 |
| [REMOTE_CONSOLE.md](./REMOTE_CONSOLE.md) | Host API + [zhin-console](https://github.com/zhinjs/zhin-console) 联调步骤 |
| [docs/console-remote.md](../../docs/console-remote.md) | Remote Console 架构与 CORS 说明 |
| [docs/adapters/index.md](../../docs/adapters/index.md) | 平台适配器矩阵（Stable / Advanced / Experimental 档位与各包文档） |

本目录 `zhin.config.yml` 启用多 bot（ICQQ、QQ 官方、GitHub、Sandbox 等）。**ICQQ** 须先 `icqq login`，配置里只写 QQ 号（`name`）；新增或切换平台时对照 [适配器索引](../../docs/adapters/index.md) 与包内 README。

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

## 许可证

MIT License
