# life-assistant-bot

Zhin.js **生活助手**示例 — 介于 `minimal-bot`（Sandbox Core）与 `test-bot`（厨房水槽）之间。

## 功能

| 能力 | 说明 |
|------|------|
| AI 对话 | ZhinAgent + Ollama，支持多轮对话 |
| 知识库 | `knowledge/` 目录，`knowledge_search` 工具自动检索 |
| 记忆 | 三层 Markdown 文件记忆（global/platform/session） |
| 助手任务 | Agent/Assistant Runtime 可创建持久任务 |
| 命令 | `/remind <text>`、`/mood [note]` |
| 安全 | bash allowlist 模式，交互式审批 |
| Console | Remote Console 管理面板 |

## 30 分钟快速体验

```bash
# 1. 安装依赖（在 monorepo 根目录）
pnpm install

# 2. 进入示例目录
cd examples/life-assistant-bot

# 3. 复制环境变量
cp .env.example .env   # 编辑 HTTP_TOKEN

# 4. 启动（需要 Ollama 运行在 localhost:11434）
pnpm dev

# 5. 打开 Remote Console
#    https://console.zhin.dev → API Base: http://127.0.0.1:8086
#    Token: 与 .env 中 HTTP_TOKEN 一致
```

## 目录结构

```
life-assistant-bot/
├── zhin.config.yml          # 主配置
├── SOUL.md                  # AI 人设（系统提示词）
├── knowledge/               # 本地知识库（自动索引）
│   └── faq.md
├── data/memory/             # 三层记忆目录
│   ├── global/
│   ├── platforms/
│   └── sessions/
├── plugin.ts                # Root Plugin 生命周期入口
├── schema.json              # Root 配置约束
├── commands/                # remind / mood
├── tools/                   # get-current-time
└── README.md
```

## 接入真实 IM

在 `package.json#zhin.plugins` 将 Sandbox child 替换为平台适配器，并在配置中使用相同 `instanceKey`：

```yaml
plugins:
  icqq:
    name: "${ICQQ_ACCOUNT}"
```

详见 [适配器文档](https://zhin.js.org/adapters/)。

## 与 minimal-bot / test-bot 的区别

| 特性 | minimal-bot | life-assistant-bot | test-bot |
|------|-------------|-------------------|----------|
| 目标 | Stable 首跑 | 生活助手 | 维护者回归 |
| 适配器 | Sandbox | Sandbox（可扩展） | 全部 |
| AI | 单 Provider | 单 Provider + 知识库 + 记忆 | 多 Provider + MCP |
| 插件数 | 1 | 1 | 20+ |
| 命令 | hello | remind + mood | 30+ |
| 知识库 | ❌ | ✅ | ✅ |
| 语义记忆 | ❌ | 可选 | ✅ |
