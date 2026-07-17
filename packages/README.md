# packages/

框架与控制台相关的 **npm 包**（pnpm workspace）。按域分子目录，**npm 包名不变**（如 `@zhin.js/core`）。

## 目录

```
packages/
  im/           # Agent + IM/通道运行时主链（单向依赖）
    plugin-runtime/  # Plugin tree / Scope / generation，零生产依赖
    feature-kit/     # 自定义 Feature provider interface
    adapter/
    command/
    component/
    middleware/
    tool/
    skill/
    agent-feature/
    mcp-feature/
    kernel/          # 旧 PluginBase / Feature / Schedule 兼容层
    ai/
    core/
    agent/
    zhin/
  console/      # 控制台栈（与 IM 平行）
    contract/
    pagemanager/
    client/
  toolkit/      # 脚手架与独立库
    create-zhin/
    scaffold-wizard/   # 共享项目配置向导（create-zhin-app + zhin setup）
    satori/
  host/         # Host 运行时（router、api、mcp）
    router/
    api/
    mcp/
```

根目录 **`zhin-console/`** 为 Remote Console 静态 UI（git submodule），不在 `packages/console/` 内。

## 构建顺序（Host）

`contract` → `pagemanager` → `client` → `packages/host/router` → `packages/host/api`

Plugin 主链：`plugin-runtime` → `feature-kit` → 领域 Feature → `core` → `agent` → `zhin`

旧 `kernel` 暂时承载 PluginBase / 可变 Feature / Schedule，存量迁移完成前由 Core 兼容使用；
新 Plugin Runtime 与 Feature provider 不依赖它。

各子包 README 摘要：

| 包 | 要点 |
|----|------|
| [`im/plugin-runtime`](im/plugin-runtime/README.md) | Plugin tree、Scope、RuntimeSnapshot、generation 与 RootController |
| [`im/feature-kit`](im/feature-kit/README.md) | Feature provider、约定发现、owner-aware projection |
| [`im/adapter`](im/adapter/README.md) · [`command`](im/command/README.md) · [`component`](im/component/README.md) · [`middleware`](im/middleware/README.md) | IM 领域 Feature npm 包 |
| [`im/tool`](im/tool/README.md) · [`skill`](im/skill/README.md) · [`agent-feature`](im/agent-feature/README.md) · [`mcp-feature`](im/mcp-feature/README.md) | Agent 领域 Feature npm 包 |
| [`im/ai`](im/ai/README.md) | Provider、`agentLoop`、`ModelRegistry` + `getModel` 白名单、`ContextRepository` / `im_transcripts` |
| [`im/core`](im/core/README.md) | Plugin、Adapter、MessageDispatcher、出站 `before.sendMessage` 链 |
| [`im/agent`](im/agent/README.md) | ZhinAgent、`AIService`、工具与安全策略、模型 `/v1/models` 发现 |
| [`im/zhin`](im/zhin/README.md) | 主入口 re-export、`registerChatMessageStore` |

持久化与模型发现细节见 [docs/advanced/ai.md](../docs/advanced/ai.md)、[架构概览](../docs/architecture-overview.md)。

详见 [docs/contributing/repo-structure.md](../docs/contributing/repo-structure.md)。
