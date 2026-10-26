import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import { WIZARD_TEMPLATES } from './message-templates.js';

/** Package-owned copy; machine values and user input are only interpolated. */
export const WIZARD_MESSAGES = {
  ...WIZARD_TEMPLATES,
  "IMAP 服务器:": {
    "zh-CN": "IMAP 服务器:",
    "en": "IMAP server:"
  },
  "IMAP 端口:": {
    "zh-CN": "IMAP 端口:",
    "en": "IMAP port:"
  },
  "邮箱地址:": {
    "zh-CN": "邮箱地址:",
    "en": "Email address:"
  },
  "邮箱密码/授权码:": {
    "zh-CN": "邮箱密码/授权码:",
    "en": "Email password / app authorization code:"
  },
  "GitHub Issue/PR 聊天 + App 认证": {
    "zh-CN": "GitHub Issue/PR 聊天 + App 认证",
    "en": "GitHub Issue/PR chat and App authentication"
  },
  "GitHub App 或 gh CLI；Webhook 由内置 HTTP Host 承接（默认 /github/webhook）；需 database 存订阅与 OAuth。": {
    "zh-CN": "GitHub App 或 gh CLI；Webhook 由内置 HTTP Host 承接（默认 /github/webhook）；需 database 存订阅与 OAuth。",
    "en": "GitHub App or gh CLI; webhooks use the built-in HTTP Host (default /github/webhook); database stores subscriptions and OAuth."
  },
  "微信 iLink（个人微信）": {
    "zh-CN": "微信 iLink（个人微信）",
    "en": "WeChat iLink (personal WeChat)"
  },
  "个人微信（iLink / ClawBot 灰度入口，长轮询，仅私聊）": {
    "zh-CN": "个人微信（iLink / ClawBot 灰度入口，长轮询，仅私聊）",
    "en": "Personal WeChat (iLink / ClawBot rollout; long polling; private messages only)"
  },
  "需最新版微信 + ClawBot 灰度资格；默认扫码绑定（bot_token 写入 .env），也可手动输入或放 data/weixin-ilink/<name>.json 侧车凭证文件。": {
    "zh-CN": "需最新版微信 + ClawBot 灰度资格；默认扫码绑定（bot_token 写入 .env），也可手动输入或放 data/weixin-ilink/<name>.json 侧车凭证文件。",
    "en": "Requires the latest WeChat and ClawBot eligibility. QR binding is the default (bot_token saved in .env); manual input or a data/weixin-ilink/<name>.json sidecar is also supported."
  },
  "🔌 配置聊天适配器": {
    "zh-CN": "🔌 配置聊天适配器",
    "en": "🔌 Configure chat adapters"
  },
  "  Sandbox 适合本地调试；生产环境请额外勾选目标 IM 平台。": {
    "zh-CN": "  Sandbox 适合本地调试；生产环境请额外勾选目标 IM 平台。",
    "en": "  Sandbox is for local debugging; also select your IM platform for production."
  },
  "  带 Webhook 的适配器需要 Endpoint 可被公网访问（或使用内网穿透）。": {
    "zh-CN": "  带 Webhook 的适配器需要 Endpoint 可被公网访问（或使用内网穿透）。",
    "en": "  Webhook adapters need a publicly reachable Endpoint (or a tunnel)."
  },
  "选择聊天平台适配器（空格选择，回车确认）:": {
    "zh-CN": "选择聊天平台适配器（空格选择，回车确认）:",
    "en": "Select chat adapters (Space to select, Enter to confirm):"
  },
  "默认必选": {
    "zh-CN": "默认必选",
    "en": "Required by default"
  },
  "至少选择一个适配器": {
    "zh-CN": "至少选择一个适配器",
    "en": "Select at least one adapter"
  },
  "  ⚠ 以下适配器通常需要公网 HTTP/Webhook：": {
    "zh-CN": "  ⚠ 以下适配器通常需要公网 HTTP/Webhook：",
    "en": "  ⚠ These adapters usually require public HTTP/Webhook access:"
  },
  "    开发时可先用 Sandbox；上线前请确保 http 端口（默认 8068）可从平台回调。": {
    "zh-CN": "    开发时可先用 Sandbox；上线前请确保 http 端口（默认 8068）可从平台回调。",
    "en": "    Use Sandbox for development; before deployment, make sure the http port (default 8068) accepts platform callbacks."
  },
  "  📝 配置 {v0} Bot": {
    "zh-CN": "  📝 配置 {v0} Bot",
    "en": "  📝 Configure {v0} Bot"
  },
  "     文档: {v0}": {
    "zh-CN": "     文档: {v0}",
    "en": "     Documentation: {v0}"
  },
  "     索引: {v0}": {
    "zh-CN": "     索引: {v0}",
    "en": "     Index: {v0}"
  },
  "{v0} 不能为空": {
    "zh-CN": "{v0} 不能为空",
    "en": "{v0} is required"
  },
  "# 适配器配置": {
    "zh-CN": "# 适配器配置",
    "en": "# Adapter configuration"
  },
  "Telegram Webhook: 确保 HTTPS 域名可从公网访问，且 http 端口已放行": {
    "zh-CN": "Telegram Webhook: 确保 HTTPS 域名可从公网访问，且 http 端口已放行",
    "en": "Telegram Webhook: make the HTTPS domain publicly reachable and allow the http port"
  },
  "Telegram polling: 本地开发可直接 pnpm dev，无需公网": {
    "zh-CN": "Telegram polling: 本地开发可直接 pnpm dev，无需公网",
    "en": "Telegram polling: run pnpm dev locally; no public URL needed"
  },
  "GitHub Webhook: App 设置 URL 为 https://<域名>/github/webhook": {
    "zh-CN": "GitHub Webhook: App 设置 URL 为 https://<域名>/github/webhook",
    "en": "GitHub Webhook: set the App URL to https://<domain>/github/webhook"
  },
  "GitHub polling: 无 Webhook 时将轮询 Events API（默认 60s）": {
    "zh-CN": "GitHub polling: 无 Webhook 时将轮询 Events API（默认 60s）",
    "en": "GitHub polling: polls the Events API without a webhook (default 60s)"
  },
  "GitHub App: 私钥路径需存在，且 App 已安装到目标仓库": {
    "zh-CN": "GitHub App: 私钥路径需存在，且 App 已安装到目标仓库",
    "en": "GitHub App: the private key path must exist and the App must be installed on the target repository"
  },
  "GitHub gh CLI: 运行 gh auth login 完成认证": {
    "zh-CN": "GitHub gh CLI: 运行 gh auth login 完成认证",
    "en": "GitHub gh CLI: run gh auth login to authenticate"
  },
  "已选适配器需要 database：脚手架将自动配置 SQLite": {
    "zh-CN": "已选适配器需要 database：脚手架将自动配置 SQLite",
    "en": "Selected adapters require database; the scaffold will configure SQLite automatically"
  },
  "OpenAI (GPT-4o, 推荐)": {
    "zh-CN": "OpenAI (GPT-4o, 推荐)",
    "en": "OpenAI (GPT-4o; recommended)"
  },
  "需 OpenAI API Key；国内可用代理 baseUrl": {
    "zh-CN": "需 OpenAI API Key；国内可用代理 baseUrl",
    "en": "Requires an OpenAI API Key; a proxy baseUrl can be used where needed"
  },
  "需 Anthropic API Key": {
    "zh-CN": "需 Anthropic API Key",
    "en": "Requires an Anthropic API Key"
  },
  "性价比高，国内直连": {
    "zh-CN": "性价比高，国内直连",
    "en": "Cost-effective; direct access in mainland China"
  },
  "Moonshot (月之暗面)": {
    "zh-CN": "Moonshot (月之暗面)",
    "en": "Moonshot"
  },
  "Kimi 同款 API": {
    "zh-CN": "Kimi 同款 API",
    "en": "API used by Kimi"
  },
  "智谱 AI (GLM)": {
    "zh-CN": "智谱 AI (GLM)",
    "en": "Zhipu AI (GLM)"
  },
  "国内直连，open.bigmodel.cn": {
    "zh-CN": "国内直连，open.bigmodel.cn",
    "en": "Direct access in mainland China: open.bigmodel.cn"
  },
  "需 Google AI API Key": {
    "zh-CN": "需 Google AI API Key",
    "en": "Requires a Google AI API Key"
  },
  "Ollama (本地部署)": {
    "zh-CN": "Ollama (本地部署)",
    "en": "Ollama (local deployment)"
  },
  "本地运行，无需 API Key；先 ollama pull 模型": {
    "zh-CN": "本地运行，无需 API Key；先 ollama pull 模型",
    "en": "Runs locally without an API Key; first run ollama pull for your model"
  },
  "OpenAI 兼容接口 (vLLM / OneAPI / SiliconFlow 等)": {
    "zh-CN": "OpenAI 兼容接口 (vLLM / OneAPI / SiliconFlow 等)",
    "en": "OpenAI-compatible API (vLLM / OneAPI / SiliconFlow, etc.)"
  },
  "任何兼容 OpenAI API 的服务，需填 baseUrl": {
    "zh-CN": "任何兼容 OpenAI API 的服务，需填 baseUrl",
    "en": "Any OpenAI-compatible API service; baseUrl is required"
  },
  "🤖 配置 AI 智能体": {
    "zh-CN": "🤖 配置 AI 智能体",
    "en": "🤖 Configure AI Agent"
  },
  "  启用后将自动写入 package.json：@zhin.js/agent、zod、ai、所选 @ai-sdk/*（启用 memory MCP 时另加 @modelcontextprotocol/sdk）。": {
    "zh-CN": "  启用后将自动写入 package.json：@zhin.js/agent、zod、ai、所选 @ai-sdk/*（启用 memory MCP 时另加 @modelcontextprotocol/sdk）。",
    "en": "  Enabling AI adds @zhin.js/agent, zod, ai and the selected @ai-sdk/* to package.json (plus @modelcontextprotocol/sdk for memory MCP)."
  },
  "  会话持久化默认开启，将自动配置 SQLite 数据库（若尚未选择）。": {
    "zh-CN": "  会话持久化默认开启，将自动配置 SQLite 数据库（若尚未选择）。",
    "en": "  Session persistence is enabled by default; SQLite is configured automatically if no database was selected."
  },
  "是否启用 AI 智能体？（大模型对话 + 工具调用）": {
    "zh-CN": "是否启用 AI 智能体？（大模型对话 + 工具调用）",
    "en": "Enable AI Agent? (LLM conversations and tool calls)"
  },
  "选择 AI 提供商:": {
    "zh-CN": "选择 AI 提供商:",
    "en": "Select an AI provider:"
  },
  "Ollama 地址:": {
    "zh-CN": "Ollama 地址:",
    "en": "Ollama address:"
  },
  "请输入 http:// 或 https:// 开头的地址": {
    "zh-CN": "请输入 http:// 或 https:// 开头的地址",
    "en": "Enter an address starting with http:// or https://"
  },
  "模型名称（需已 ollama pull）:": {
    "zh-CN": "模型名称（需已 ollama pull）:",
    "en": "Model name (already pulled with ollama pull):"
  },
  "模型名不能为空": {
    "zh-CN": "模型名不能为空",
    "en": "Model name is required"
  },
  "API Key 不能为空（可稍后在 .env 中填写 AI_API_KEY）": {
    "zh-CN": "API Key 不能为空（可稍后在 .env 中填写 AI_API_KEY）",
    "en": "API Key is required (you can fill AI_API_KEY in .env later)"
  },
  "模型名称（服务端实际部署的模型 ID）:": {
    "zh-CN": "模型名称（服务端实际部署的模型 ID）:",
    "en": "Model name (the model ID deployed on the server):"
  },
  "模型名称:": {
    "zh-CN": "模型名称:",
    "en": "Model name:"
  },
  "模型名称不能为空": {
    "zh-CN": "模型名称不能为空",
    "en": "Model name is required"
  },
  "API 地址（openai-compatible 必填，如 https://api.example.com/v1）:": {
    "zh-CN": "API 地址（openai-compatible 必填，如 https://api.example.com/v1）:",
    "en": "API address (required for openai-compatible, for example https://api.example.com/v1):"
  },
  "自定义 API 地址（留空使用官方默认）:": {
    "zh-CN": "自定义 API 地址（留空使用官方默认）:",
    "en": "Custom API address (leave blank for the official default):"
  },
  "baseUrl 不能为空（openai-compatible SDK 必须指定 API 地址）": {
    "zh-CN": "baseUrl 不能为空（openai-compatible SDK 必须指定 API 地址）",
    "en": "baseUrl is required (the openai-compatible SDK requires an API address)"
  },
  "⚡ 配置 AI 触发方式": {
    "zh-CN": "⚡ 配置 AI 触发方式",
    "en": "⚡ Configure AI triggers"
  },
  "  决定 Endpoint 何时自动调用大模型；命令（/ 开头）不会被 AI 拦截。": {
    "zh-CN": "  决定 Endpoint 何时自动调用大模型；命令（/ 开头）不会被 AI 拦截。",
    "en": "  Choose when the Endpoint calls the model automatically; commands with the configured command prefix are handled separately."
  },
  "响应 @机器人 的消息？": {
    "zh-CN": "响应 @机器人 的消息？",
    "en": "Respond when the bot is mentioned?"
  },
  "响应私聊消息？": {
    "zh-CN": "响应私聊消息？",
    "en": "Respond to private messages?"
  },
  "触发前缀（逗号分隔，如 #,ai:）:": {
    "zh-CN": "触发前缀（逗号分隔，如 #,ai:）:",
    "en": "Trigger prefixes (comma-separated, for example #,ai:):"
  },
  "🛡️  配置 Agent 安全与能力": {
    "zh-CN": "🛡️  配置 Agent 安全与能力",
    "en": "🛡️  Configure Agent safety and capabilities"
  },
  "  生产环境建议 execSecurity: deny；开发调试可选 allowlist。": {
    "zh-CN": "  生产环境建议 execSecurity: deny；开发调试可选 allowlist。",
    "en": "  execSecurity: deny is recommended in production; allowlist is available for development."
  },
  "命令执行安全策略:": {
    "zh-CN": "命令执行安全策略:",
    "en": "Command execution security policy:"
  },
  "deny — 禁止执行 shell（推荐）": {
    "zh-CN": "deny — 禁止执行 shell（推荐）",
    "en": "deny — no shell execution (recommended)"
  },
  "allowlist — 仅允许白名单命令": {
    "zh-CN": "allowlist — 仅允许白名单命令",
    "en": "allowlist — allow listed commands only"
  },
  "full — 允许任意命令（仅本地调试）": {
    "zh-CN": "full — 允许任意命令（仅本地调试）",
    "en": "full — allow arbitrary commands (local debugging only)"
  },
  "启用本地知识图谱 memory MCP？（data/knowledge-graph.jsonl）": {
    "zh-CN": "启用本地知识图谱 memory MCP？（data/knowledge-graph.jsonl）",
    "en": "Enable local knowledge-graph memory MCP? (data/knowledge-graph.jsonl)"
  },
  "输出 Agent 阶段日志（便于排障）？": {
    "zh-CN": "输出 Agent 阶段日志（便于排障）？",
    "en": "Log Agent phases for troubleshooting?"
  },
  "# AI 配置": {
    "zh-CN": "# AI 配置",
    "en": "# AI configuration"
  },
  "键 \"{v0}\"": {
    "zh-CN": "键 \"{v0}\"",
    "en": "key \"{v0}\""
  },
  "[zhin setup] plugins.{v0} 的 {v1} 已被向导结果覆盖": {
    "zh-CN": "[zhin setup] plugins.{v0} 的 {v1} 已被向导结果覆盖",
    "en": "[zhin setup] wizard results replaced {v1} in plugins.{v0}"
  },
  "推荐，零配置，适合单机 Bot": {
    "zh-CN": "推荐，零配置，适合单机 Bot",
    "en": "Recommended; zero configuration for a single Bot instance"
  },
  "Node.js 内置 node:sqlite（Node.js 22.5+）": {
    "zh-CN": "Node.js 内置 node:sqlite（Node.js 22.5+）",
    "en": "Built-in Node.js node:sqlite (Node.js 22.5+)"
  },
  "关系型数据库": {
    "zh-CN": "关系型数据库",
    "en": "Relational database"
  },
  "关系型数据库，方言名为 pg": {
    "zh-CN": "关系型数据库，方言名为 pg",
    "en": "Relational database; dialect name is pg"
  },
  "文档数据库": {
    "zh-CN": "文档数据库",
    "en": "Document database"
  },
  "键值数据库": {
    "zh-CN": "键值数据库",
    "en": "Key-value database"
  },
  "仅进程内，适合测试，不持久化": {
    "zh-CN": "仅进程内，适合测试，不持久化",
    "en": "In-process only; for testing; no persistence"
  },
  "Zhin 内置实现": {
    "zh-CN": "Zhin 内置实现",
    "en": "Built into Zhin"
  },
  "；驱动 {v0} {v1}": {
    "zh-CN": "；驱动 {v0} {v1}",
    "en": "; driver {v0} {v1}"
  },
  "{v0}（{v1}；当前支持/实机验证 {v2}{v3}）": {
    "zh-CN": "{v0}（{v1}；当前支持/实机验证 {v2}{v3}）",
    "en": "{v0} ({v1}; supported/live-tested: {v2}{v3})"
  },
  "环境变量 {v0} 未设置（{v1}）": {
    "zh-CN": "环境变量 {v0} 未设置（{v1}）",
    "en": "Environment variable {v0} is not set ({v1})"
  },
  "{v0} 必须是 {v1}": {
    "zh-CN": "{v0} 必须是 {v1}",
    "en": "{v0} must be {v1}"
  },
  "{v0} 必须是对象": {
    "zh-CN": "{v0} 必须是对象",
    "en": "{v0} must be an object"
  },
  "{v0}.{v1} 不是受支持的配置项": {
    "zh-CN": "{v0}.{v1} 不是受支持的配置项",
    "en": "{v0}.{v1} is not a supported configuration field"
  },
  "{v0}.{v1} 不能为空": {
    "zh-CN": "{v0}.{v1} 不能为空",
    "en": "{v0}.{v1} is required"
  },
  "{v0} 必须是字符串": {
    "zh-CN": "{v0} 必须是字符串",
    "en": "{v0} must be a string"
  },
  "{v0} 格式无效": {
    "zh-CN": "{v0} 格式无效",
    "en": "{v0} has an invalid format"
  },
  "{v0} 必须是 {v1} 之一": {
    "zh-CN": "{v0} 必须是 {v1} 之一",
    "en": "{v0} must be one of {v1}"
  },
  "{v0} 必须是整数": {
    "zh-CN": "{v0} 必须是整数",
    "en": "{v0} must be an integer"
  },
  "{v0} 不能小于 {v1}": {
    "zh-CN": "{v0} 不能小于 {v1}",
    "en": "{v0} must be at least {v1}"
  },
  "{v0} 不能大于 {v1}": {
    "zh-CN": "{v0} 不能大于 {v1}",
    "en": "{v0} must not exceed {v1}"
  },
  "database 必须是对象": {
    "zh-CN": "database 必须是对象",
    "en": "database must be an object"
  },
  "database.dialect 不能为空": {
    "zh-CN": "database.dialect 不能为空",
    "en": "database.dialect is required"
  },
  "不支持的数据库方言 {v0}": {
    "zh-CN": "不支持的数据库方言 {v0}",
    "en": "Unsupported database dialect {v0}"
  },
  "请输入有效的整数 ({v0}-{v1})": {
    "zh-CN": "请输入有效的整数 ({v0}-{v1})",
    "en": "Enter a valid integer ({v0}-{v1})"
  },
  "选择数据库类型:": {
    "zh-CN": "选择数据库类型:",
    "en": "Select a database type:"
  },
  "未支持的数据库类型: {v0}": {
    "zh-CN": "未支持的数据库类型: {v0}",
    "en": "Unsupported database type: {v0}"
  },
  "数据库配置不符合 Schema：{v0}": {
    "zh-CN": "数据库配置不符合 Schema：{v0}",
    "en": "Database configuration does not match its Schema: {v0}"
  },
  "SQLite 数据库文件路径:": {
    "zh-CN": "SQLite 数据库文件路径:",
    "en": "SQLite database file path:"
  },
  "文件路径不能为空": {
    "zh-CN": "文件路径不能为空",
    "en": "File path is required"
  },
  "SQLite 模式:": {
    "zh-CN": "SQLite 模式:",
    "en": "SQLite mode:"
  },
  "WAL (推荐, 并发性能好)": {
    "zh-CN": "WAL (推荐, 并发性能好)",
    "en": "WAL (recommended for concurrency)"
  },
  "DELETE (默认)": {
    "zh-CN": "DELETE (默认)",
    "en": "DELETE (default)"
  },
  "MEMORY (内存数据库)": {
    "zh-CN": "MEMORY (内存数据库)",
    "en": "MEMORY (in-memory database)"
  },
  "MySQL 主机地址:": {
    "zh-CN": "MySQL 主机地址:",
    "en": "MySQL host:"
  },
  "MySQL 端口:": {
    "zh-CN": "MySQL 端口:",
    "en": "MySQL port:"
  },
  "MySQL 用户名:": {
    "zh-CN": "MySQL 用户名:",
    "en": "MySQL username:"
  },
  "MySQL 密码:": {
    "zh-CN": "MySQL 密码:",
    "en": "MySQL password:"
  },
  "MySQL 数据库名:": {
    "zh-CN": "MySQL 数据库名:",
    "en": "MySQL database name:"
  },
  "数据库名不能为空": {
    "zh-CN": "数据库名不能为空",
    "en": "Database name is required"
  },
  "PostgreSQL 主机地址:": {
    "zh-CN": "PostgreSQL 主机地址:",
    "en": "PostgreSQL host:"
  },
  "PostgreSQL 端口:": {
    "zh-CN": "PostgreSQL 端口:",
    "en": "PostgreSQL port:"
  },
  "PostgreSQL 用户名:": {
    "zh-CN": "PostgreSQL 用户名:",
    "en": "PostgreSQL username:"
  },
  "PostgreSQL 密码:": {
    "zh-CN": "PostgreSQL 密码:",
    "en": "PostgreSQL password:"
  },
  "PostgreSQL 数据库名:": {
    "zh-CN": "PostgreSQL 数据库名:",
    "en": "PostgreSQL database name:"
  },
  "MongoDB 连接字符串:": {
    "zh-CN": "MongoDB 连接字符串:",
    "en": "MongoDB connection string:"
  },
  "连接字符串不能为空": {
    "zh-CN": "连接字符串不能为空",
    "en": "Connection string is required"
  },
  "请输入有效的 MongoDB 连接字符串": {
    "zh-CN": "请输入有效的 MongoDB 连接字符串",
    "en": "Enter a valid MongoDB connection string"
  },
  "MongoDB 数据库名:": {
    "zh-CN": "MongoDB 数据库名:",
    "en": "MongoDB database name:"
  },
  "Redis 主机地址:": {
    "zh-CN": "Redis 主机地址:",
    "en": "Redis host:"
  },
  "Redis 端口:": {
    "zh-CN": "Redis 端口:",
    "en": "Redis port:"
  },
  "Redis 密码 (可选):": {
    "zh-CN": "Redis 密码 (可选):",
    "en": "Redis password (optional):"
  },
  "Redis 数据库索引:": {
    "zh-CN": "Redis 数据库索引:",
    "en": "Redis database index:"
  },
  "请输入有效的数据库索引 (>= 0)": {
    "zh-CN": "请输入有效的数据库索引 (>= 0)",
    "en": "Enter a valid database index (>= 0)"
  },
  "先运行 zhin setup --ai 配置聊天模型，再运行 zhin setup --decisions。Jev 决策模型不能替代聊天模型。": {
    "zh-CN": "先运行 zhin setup --ai 配置聊天模型，再运行 zhin setup --decisions。Jev 决策模型不能替代聊天模型。",
    "en": "Run zhin setup --ai to configure a chat model before zhin setup --decisions. A Jev decision model cannot replace the chat model."
  },
  "\nTypeSafe Jev：选择 Agent / Skill / Tool 的可选决策服务。": {
    "zh-CN": "\nTypeSafe Jev：选择 Agent / Skill / Tool 的可选决策服务。",
    "en": "\nTypeSafe Jev: optional decision service for selecting Agents, Skills and Tools."
  },
  "shadow 仅记录建议，不改变已有行为；active 启用推荐。审核默认关闭。调用会向外部服务发送经过权限过滤的请求与候选描述。": {
    "zh-CN": "shadow 仅记录建议，不改变已有行为；active 启用推荐。审核默认关闭。调用会向外部服务发送经过权限过滤的请求与候选描述。",
    "en": "shadow only records suggestions; active enables recommendations. Review is disabled by default. Calls send permission-filtered requests and candidate descriptions to an external service."
  },
  "决策插件实例名": {
    "zh-CN": "决策插件实例名",
    "en": "Decision plugin instance name"
  },
  "使用小写字母、数字和连字符，字母开头": {
    "zh-CN": "使用小写字母、数字和连字符，字母开头",
    "en": "Use lowercase letters, digits and hyphens, starting with a letter"
  },
  "TypeSafe API Key（仅写入 .env）": {
    "zh-CN": "TypeSafe API Key（仅写入 .env）",
    "en": "TypeSafe API Key (written only to .env)"
  },
  "请输入 API Key": {
    "zh-CN": "请输入 API Key",
    "en": "Enter an API Key"
  },
  "Jev 模型（生产校准后建议固定版本）": {
    "zh-CN": "Jev 模型（生产校准后建议固定版本）",
    "en": "Jev model (pin a version after production calibration)"
  },
  "请输入模型名称": {
    "zh-CN": "请输入模型名称",
    "en": "Enter a model name"
  },
  "Skill / Tool 推荐运行方式": {
    "zh-CN": "Skill / Tool 推荐运行方式",
    "en": "Skill / Tool recommendation mode"
  },
  "shadow：观察建议，评估后再启用": {
    "zh-CN": "shadow：观察建议，评估后再启用",
    "en": "shadow: observe suggestions before enabling"
  },
  "active：启用推荐，权限仍由 Zhin 校验": {
    "zh-CN": "active：启用推荐，权限仍由 Zhin 校验",
    "en": "active: enable recommendations; Zhin still validates permissions"
  },
  "ai.decisions 含有未知配置字段。": {
    "zh-CN": "ai.decisions 含有未知配置字段。",
    "en": "ai.decisions contains unknown fields."
  },
  "ai.decisions.provider 必须是精确插件 owner，例如 root/typesafe。": {
    "zh-CN": "ai.decisions.provider 必须是精确插件 owner，例如 root/typesafe。",
    "en": "ai.decisions.provider must be an exact plugin owner, for example root/typesafe."
  },
  "ai.decisions.{v0} 含有未知配置字段。": {
    "zh-CN": "ai.decisions.{v0} 含有未知配置字段。",
    "en": "ai.decisions.{v0} contains unknown fields."
  },
  "ai.decisions.{v0}.mode 必须是 off、shadow 或 active。": {
    "zh-CN": "ai.decisions.{v0}.mode 必须是 off、shadow 或 active。",
    "en": "ai.decisions.{v0}.mode must be off, shadow or active."
  },
  "ai.decisions.{v0}.{v1} 必须是正整数。": {
    "zh-CN": "ai.decisions.{v0}.{v1} 必须是正整数。",
    "en": "ai.decisions.{v0}.{v1} must be a positive integer."
  },
  "ai.decisions.{v0}.minConfidence 必须在 0 到 1 之间。": {
    "zh-CN": "ai.decisions.{v0}.minConfidence 必须在 0 到 1 之间。",
    "en": "ai.decisions.{v0}.minConfidence must be between 0 and 1."
  },
  "决策服务需要已启用的 AI Agent；运行 zhin setup --ai。": {
    "zh-CN": "决策服务需要已启用的 AI Agent；运行 zhin setup --ai。",
    "en": "The decision service requires an enabled AI Agent; run zhin setup --ai."
  },
  "决策插件实例未在主配置 plugins 中声明。": {
    "zh-CN": "决策插件实例未在主配置 plugins 中声明。",
    "en": "The decision plugin instance is not declared in the root plugins configuration."
  },
  "绑定的决策插件已停用。": {
    "zh-CN": "绑定的决策插件已停用。",
    "en": "The bound decision plugin is disabled."
  },
  "绑定的 TypeSafe 插件已禁用。": {
    "zh-CN": "绑定的 TypeSafe 插件已禁用。",
    "en": "The bound TypeSafe plugin is disabled."
  },
  "TypeSafe 插件缺少 apiKey 环境变量引用。": {
    "zh-CN": "TypeSafe 插件缺少 apiKey 环境变量引用。",
    "en": "The TypeSafe plugin is missing an apiKey environment reference."
  },
  "package.json 缺少 @zhin.js/service-typesafe 依赖。": {
    "zh-CN": "package.json 缺少 @zhin.js/service-typesafe 依赖。",
    "en": "package.json is missing the @zhin.js/service-typesafe dependency."
  },
  "# MySQL 数据库配置": {
    "zh-CN": "# MySQL 数据库配置",
    "en": "# MySQL database configuration"
  },
  "# PostgreSQL 数据库配置": {
    "zh-CN": "# PostgreSQL 数据库配置",
    "en": "# PostgreSQL database configuration"
  },
  "# MongoDB 数据库配置": {
    "zh-CN": "# MongoDB 数据库配置",
    "en": "# MongoDB database configuration"
  },
  "# Redis 数据库配置": {
    "zh-CN": "# Redis 数据库配置",
    "en": "# Redis database configuration"
  },
  "ai.multimodal.audio.strategy 为 transcribe": {
    "zh-CN": "ai.multimodal.audio.strategy 为 transcribe",
    "en": "ai.multimodal.audio.strategy is transcribe"
  },
  "已配置 speech:": {
    "zh-CN": "已配置 speech:",
    "en": "speech is configured:"
  },
  "已配置 htmlRenderer:": {
    "zh-CN": "已配置 htmlRenderer:",
    "en": "htmlRenderer is configured:"
  },
  "adapter 出站 policy 使用 html/markdown→image": {
    "zh-CN": "adapter 出站 policy 使用 html/markdown→image",
    "en": "adapter outbound policy uses html/markdown→image"
  },
  "     文档: ": {
    "zh-CN": "     文档: ",
    "en": "     Documentation: "
  },
  "  Endpoint 标识名称:": {
    "zh-CN": "  Endpoint 标识名称:",
    "en": "  Endpoint identifier:"
  },
  "名称不能为空": {
    "zh-CN": "名称不能为空",
    "en": "Name is required"
  },
  "  Telegram Endpoint Token（@BotFather 获取）:": {
    "zh-CN": "  Telegram Endpoint Token（@BotFather 获取）:",
    "en": "  Telegram Endpoint Token (from @BotFather):"
  },
  "Token 不能为空": {
    "zh-CN": "Token 不能为空",
    "en": "Token is required"
  },
  "  消息接收方式:": {
    "zh-CN": "  消息接收方式:",
    "en": "  Receive messages via:"
  },
  "长轮询 polling（默认，本地开发无需公网）": {
    "zh-CN": "长轮询 polling（默认，本地开发无需公网）",
    "en": "Polling (default; no public URL needed for local development)"
  },
  "Webhook（生产环境，需 HTTPS 公网域名）": {
    "zh-CN": "Webhook（生产环境，需 HTTPS 公网域名）",
    "en": "Webhook (production; requires a public HTTPS domain)"
  },
  "     Webhook 前置条件：": {
    "zh-CN": "     Webhook 前置条件：",
    "en": "     Webhook prerequisites:"
  },
  "     • Endpoint 进程需绑定可被 Telegram 访问的 HTTPS 域名（有效 TLS 证书）": {
    "zh-CN": "     • Endpoint 进程需绑定可被 Telegram 访问的 HTTPS 域名（有效 TLS 证书）",
    "en": "     • The Endpoint process needs an HTTPS domain reachable by Telegram with a valid TLS certificate"
  },
  "     • Webhook 由内置 HTTP Host（zhin runtime start）承接，防火墙/反向代理需放行 http 端口": {
    "zh-CN": "     • Webhook 由内置 HTTP Host（zhin runtime start）承接，防火墙/反向代理需放行 http 端口",
    "en": "     • The built-in HTTP Host (zhin runtime start) receives webhooks; allow the http port through your firewall/reverse proxy"
  },
  "  Webhook 公网 HTTPS 域名（如 https://bot.example.com）:": {
    "zh-CN": "  Webhook 公网 HTTPS 域名（如 https://bot.example.com）:",
    "en": "  Public webhook HTTPS domain (for example https://bot.example.com):"
  },
  "域名不能为空": {
    "zh-CN": "域名不能为空",
    "en": "Domain is required"
  },
  "须以 https:// 开头": {
    "zh-CN": "须以 https:// 开头",
    "en": "Must start with https://"
  },
  "  Webhook 路径:": {
    "zh-CN": "  Webhook 路径:",
    "en": "  Webhook path:"
  },
  "  认证方式:": {
    "zh-CN": "  认证方式:",
    "en": "  Authentication:"
  },
  "GitHub App（推荐生产：JWT → Installation Token）": {
    "zh-CN": "GitHub App（推荐生产：JWT → Installation Token）",
    "en": "GitHub App (recommended for production: JWT → Installation Token)"
  },
  "gh CLI（本地开发：需 gh auth login）": {
    "zh-CN": "gh CLI（本地开发：需 gh auth login）",
    "en": "gh CLI (local development: requires gh auth login)"
  },
  "     在 github.com/settings/apps 创建 App，记录 App ID 并下载 .pem 私钥": {
    "zh-CN": "     在 github.com/settings/apps 创建 App，记录 App ID 并下载 .pem 私钥",
    "en": "     Create an App at github.com/settings/apps, record its App ID and download the .pem private key"
  },
  "App ID 不能为空": {
    "zh-CN": "App ID 不能为空",
    "en": "App ID is required"
  },
  "  私钥路径或 PEM 内容（如 ./data/github-app.pem）:": {
    "zh-CN": "  私钥路径或 PEM 内容（如 ./data/github-app.pem）:",
    "en": "  Private key path or PEM content (for example ./data/github-app.pem):"
  },
  "私钥不能为空": {
    "zh-CN": "私钥不能为空",
    "en": "Private key is required"
  },
  "     请确保已执行 gh auth login，且 gh 在 PATH 中": {
    "zh-CN": "     请确保已执行 gh auth login，且 gh 在 PATH 中",
    "en": "     Run gh auth login and make sure gh is on PATH"
  },
  "  事件接收方式:": {
    "zh-CN": "  事件接收方式:",
    "en": "  Receive events via:"
  },
  "Webhook 实时推送（由内置 HTTP Host 承接，需公网 URL）": {
    "zh-CN": "Webhook 实时推送（由内置 HTTP Host 承接，需公网 URL）",
    "en": "Webhook (built-in HTTP Host; requires a public URL)"
  },
  "轮询 polling（无需公网，默认 60s 间隔）": {
    "zh-CN": "轮询 polling（无需公网，默认 60s 间隔）",
    "en": "Polling (no public URL; default interval 60s)"
  },
  "     • Webhook 由内置 HTTP Host（zhin runtime start 的 http 配置）承接": {
    "zh-CN": "     • Webhook 由内置 HTTP Host（zhin runtime start 的 http 配置）承接",
    "en": "     • The built-in HTTP Host receives webhooks (http configuration for zhin runtime start)"
  },
  "     • GitHub App Webhook URL 填 https://<你的域名>/github/webhook": {
    "zh-CN": "     • GitHub App Webhook URL 填 https://<你的域名>/github/webhook",
    "en": "     • Set the GitHub App Webhook URL to https://<your-domain>/github/webhook"
  },
  "  Webhook Secret（与 GitHub App 设置一致）:": {
    "zh-CN": "  Webhook Secret（与 GitHub App 设置一致）:",
    "en": "  Webhook Secret (must match GitHub App settings):"
  },
  "Webhook 模式需填写 Secret": {
    "zh-CN": "Webhook 模式需填写 Secret",
    "en": "Webhook mode requires a Secret"
  },
  "  轮询间隔（秒）:": {
    "zh-CN": "  轮询间隔（秒）:",
    "en": "  Polling interval (seconds):"
  },
  "建议不小于 10 秒": {
    "zh-CN": "建议不小于 10 秒",
    "en": "At least 10 seconds is recommended"
  },
  "  配置 server-github MCP PAT？（可选，用于 fork 等 MCP 工具）": {
    "zh-CN": "  配置 server-github MCP PAT？（可选，用于 fork 等 MCP 工具）",
    "en": "  Configure a server-github MCP PAT? (optional; for MCP tools such as fork)"
  },
  "PAT 不能为空": {
    "zh-CN": "PAT 不能为空",
    "en": "PAT is required"
  },
  "  连接方式:": {
    "zh-CN": "  连接方式:",
    "en": "  Connection mode:"
  },
  "正向 WebSocket (ws) — 本 Endpoint 连接 OneBot 实现": {
    "zh-CN": "正向 WebSocket (ws) — 本 Endpoint 连接 OneBot 实现",
    "en": "Forward WebSocket (ws) — this Endpoint connects to the OneBot implementation"
  },
  "反向 WebSocket (wss) — OneBot 实现连本 Bot（由内置 HTTP Host 承接）": {
    "zh-CN": "反向 WebSocket (wss) — OneBot 实现连本 Bot（由内置 HTTP Host 承接）",
    "en": "Reverse WebSocket (wss) — the OneBot implementation connects to this Bot (built-in HTTP Host)"
  },
  "  OneBot WS 地址:": {
    "zh-CN": "  OneBot WS 地址:",
    "en": "  OneBot WS address:"
  },
  "地址不能为空": {
    "zh-CN": "地址不能为空",
    "en": "Address is required"
  },
  "     反向 WS 由内置 HTTP Host 承接，OneBot 实现配置连接到此 Bot": {
    "zh-CN": "     反向 WS 由内置 HTTP Host 承接，OneBot 实现配置连接到此 Bot",
    "en": "     The built-in HTTP Host accepts reverse WS; configure the OneBot implementation to connect to this Bot"
  },
  "  反向 WS 路径:": {
    "zh-CN": "  反向 WS 路径:",
    "en": "  Reverse WS path:"
  },
  "路径不能为空": {
    "zh-CN": "路径不能为空",
    "en": "Path is required"
  },
  "  access_token（无则留空）:": {
    "zh-CN": "  access_token（无则留空）:",
    "en": "  access_token (leave blank if none):"
  },
  "  App ID（QQ 开放平台）:": {
    "zh-CN": "  App ID（QQ 开放平台）:",
    "en": "  App ID (QQ Open Platform):"
  },
  "Secret 不能为空": {
    "zh-CN": "Secret 不能为空",
    "en": "Secret is required"
  },
  "  消息接收模式 (mode):": {
    "zh-CN": "  消息接收模式 (mode):",
    "en": "  Message receive mode (mode):"
  },
  "websocket — WebSocket 网关（默认，无需公网）": {
    "zh-CN": "websocket — WebSocket 网关（默认，无需公网）",
    "en": "websocket — WebSocket gateway (default; no public URL)"
  },
  "webhook — HTTP 回调（需公网可达的内置 HTTP Host）": {
    "zh-CN": "webhook — HTTP 回调（需公网可达的内置 HTTP Host）",
    "en": "webhook — HTTP callback (requires a publicly reachable built-in HTTP Host)"
  },
  "  沙箱环境 (sandbox)?": {
    "zh-CN": "  沙箱环境 (sandbox)?",
    "en": "  Sandbox environment (sandbox)?"
  },
  "  公域 / 私域（决定频道消息 intents；群聊与群成员事件两边都有）:": {
    "zh-CN": "  公域 / 私域（决定频道消息 intents；群聊与群成员事件两边都有）:",
    "en": "  Public / private scope (controls channel message intents; both include group and member events):"
  },
  "public — 公域（频道仅 @；+ 群聊/私聊）": {
    "zh-CN": "public — 公域（频道仅 @；+ 群聊/私聊）",
    "en": "public — public scope (channel mentions only; plus group/private messages)"
  },
  "private — 私域（频道全量消息；+ 群聊/私聊；公域勿选）": {
    "zh-CN": "private — 私域（频道全量消息；+ 群聊/私聊；公域勿选）",
    "en": "private — private scope (all channel messages; plus group/private messages; do not select for a public Bot)"
  },
  "Gateway WebSocket（常规 Bot，推荐）": {
    "zh-CN": "Gateway WebSocket（常规 Bot，推荐）",
    "en": "Gateway WebSocket (standard Bot; recommended)"
  },
  "Interactions HTTP（斜杠命令，经 Runtime Host HTTP 入站）": {
    "zh-CN": "Interactions HTTP（斜杠命令，经 Runtime Host HTTP 入站）",
    "en": "Interactions HTTP (slash commands through Runtime Host HTTP ingress)"
  },
  "     Interactions 模式由内置 HTTP Host 承接，需 Developer Portal 中的公钥": {
    "zh-CN": "     Interactions 模式由内置 HTTP Host 承接，需 Developer Portal 中的公钥",
    "en": "     The built-in HTTP Host receives Interactions; provide the public key from Developer Portal"
  },
  "不能为空": {
    "zh-CN": "不能为空",
    "en": "Required"
  },
  "  Interactions 路径:": {
    "zh-CN": "  Interactions 路径:",
    "en": "  Interactions path:"
  },
  "Socket Mode（无需公网，需 App Token）": {
    "zh-CN": "Socket Mode（无需公网，需 App Token）",
    "en": "Socket Mode (no public URL; requires App Token)"
  },
  "HTTP Events API（需公网 URL + 端口）": {
    "zh-CN": "HTTP Events API（需公网 URL + 端口）",
    "en": "HTTP Events API (requires public URL and port)"
  },
  "  App Token (xapp-...，Socket Mode 必需):": {
    "zh-CN": "  App Token (xapp-...，Socket Mode 必需):",
    "en": "  App Token (xapp-...; required for Socket Mode):"
  },
  "App Token 不能为空": {
    "zh-CN": "App Token 不能为空",
    "en": "App Token is required"
  },
  "     HTTP 模式由内置 HTTP Host 承接，需公网可达并配置 Slack Event Subscriptions URL": {
    "zh-CN": "     HTTP 模式由内置 HTTP Host 承接，需公网可达并配置 Slack Event Subscriptions URL",
    "en": "     HTTP mode uses the built-in HTTP Host; make it publicly reachable and configure the Slack Event Subscriptions URL"
  },
  "正向 WebSocket (ws) — 本 Bot 连接 NapCat": {
    "zh-CN": "正向 WebSocket (ws) — 本 Bot 连接 NapCat",
    "en": "Forward WebSocket (ws) — this Bot connects to NapCat"
  },
  "反向 WebSocket (wss) — NapCat 连本 Bot（由内置 HTTP Host 承接）": {
    "zh-CN": "反向 WebSocket (wss) — NapCat 连本 Bot（由内置 HTTP Host 承接）",
    "en": "Reverse WebSocket (wss) — NapCat connects to this Bot (built-in HTTP Host)"
  },
  "HTTP (http) — POST 上报入站 + HTTP API 出站（由内置 HTTP Host 承接）": {
    "zh-CN": "HTTP (http) — POST 上报入站 + HTTP API 出站（由内置 HTTP Host 承接）",
    "en": "HTTP (http) — POST ingress and HTTP API egress (built-in HTTP Host)"
  },
  "  NapCat WS 地址:": {
    "zh-CN": "  NapCat WS 地址:",
    "en": "  NapCat WS address:"
  },
  "     反向 WS 由内置 HTTP Host 承接，NapCat 配置连接到此 Bot": {
    "zh-CN": "     反向 WS 由内置 HTTP Host 承接，NapCat 配置连接到此 Bot",
    "en": "     The built-in HTTP Host accepts reverse WS; configure NapCat to connect to this Bot"
  },
  "  NapCat HTTP API 地址（出站）:": {
    "zh-CN": "  NapCat HTTP API 地址（出站）:",
    "en": "  NapCat HTTP API address (outbound):"
  },
  "  HTTP POST 上报路径（入站）:": {
    "zh-CN": "  HTTP POST 上报路径（入站）:",
    "en": "  HTTP POST event path (inbound):"
  },
  "正向 WebSocket (ws) — 本 Bot 连接 OneBot 实现": {
    "zh-CN": "正向 WebSocket (ws) — 本 Bot 连接 OneBot 实现",
    "en": "Forward WebSocket (ws) — this Bot connects to the OneBot implementation"
  },
  "HTTP Webhook (webhook) — POST 入站 + api_url HTTP 出站（由内置 HTTP Host 承接）": {
    "zh-CN": "HTTP Webhook (webhook) — POST 入站 + api_url HTTP 出站（由内置 HTTP Host 承接）",
    "en": "HTTP Webhook (webhook) — POST ingress and api_url HTTP egress (built-in HTTP Host)"
  },
  "  Webhook POST 路径（入站）:": {
    "zh-CN": "  Webhook POST 路径（入站）:",
    "en": "  Webhook POST path (inbound):"
  },
  "  HTTP action 地址（出站）:": {
    "zh-CN": "  HTTP action 地址（出站）:",
    "en": "  HTTP action address (outbound):"
  },
  "正向 WebSocket (ws) — 本 Bot 连协议端 ws(s)://baseUrl/event": {
    "zh-CN": "正向 WebSocket (ws) — 本 Bot 连协议端 ws(s)://baseUrl/event",
    "en": "Forward WebSocket (ws) — this Bot connects to ws(s)://baseUrl/event"
  },
  "Webhook (webhook) — POST 入站 + baseUrl HTTP API 出站（由内置 HTTP Host 承接）": {
    "zh-CN": "Webhook (webhook) — POST 入站 + baseUrl HTTP API 出站（由内置 HTTP Host 承接）",
    "en": "Webhook (webhook) — POST ingress and baseUrl HTTP API egress (built-in HTTP Host)"
  },
  "反向 WebSocket (wss) — 由内置 HTTP Host 承接": {
    "zh-CN": "反向 WebSocket (wss) — 由内置 HTTP Host 承接",
    "en": "Reverse WebSocket (wss) — accepted by the built-in HTTP Host"
  },
  "baseUrl 不能为空": {
    "zh-CN": "baseUrl 不能为空",
    "en": "baseUrl is required"
  },
  "  {v0} 路径:": {
    "zh-CN": "  {v0} 路径:",
    "en": "  {v0} path:"
  },
  "反向 WS": {
    "zh-CN": "反向 WS",
    "en": "Reverse WS"
  },
  "正向 WebSocket (ws) — 本 Bot 连 Satori SDK": {
    "zh-CN": "正向 WebSocket (ws) — 本 Bot 连 Satori SDK",
    "en": "Forward WebSocket (ws) — this Bot connects to the Satori SDK"
  },
  "Webhook (webhook) — SDK POST 事件到 path（由内置 HTTP Host 承接）": {
    "zh-CN": "Webhook (webhook) — SDK POST 事件到 path（由内置 HTTP Host 承接）",
    "en": "Webhook (webhook) — SDK posts events to path (built-in HTTP Host)"
  },
  "  Webhook POST 路径:": {
    "zh-CN": "  Webhook POST 路径:",
    "en": "  Webhook POST path:"
  },
  "  Bearer Token（无则留空）:": {
    "zh-CN": "  Bearer Token（无则留空）:",
    "en": "  Bearer Token (leave blank if none):"
  },
  "     直连 @icqqjs/icqq 协议库，启动时自动登录": {
    "zh-CN": "     直连 @icqqjs/icqq 协议库，启动时自动登录",
    "en": "     Connects directly through @icqqjs/icqq and signs in at startup"
  },
  "  QQ 号（uin）:": {
    "zh-CN": "  QQ 号（uin）:",
    "en": "  QQ account (uin):"
  },
  "QQ 号必须为纯数字": {
    "zh-CN": "QQ 号必须为纯数字",
    "en": "QQ account must contain digits only"
  },
  "  主人 QQ 号（master，/approve 等管理命令）:": {
    "zh-CN": "  主人 QQ 号（master，/approve 等管理命令）:",
    "en": "  Owner QQ account (master; approval and other management commands):"
  },
  "主人 QQ 号必须为纯数字": {
    "zh-CN": "主人 QQ 号必须为纯数字",
    "en": "Owner QQ account must contain digits only"
  },
  "  登录方式:": {
    "zh-CN": "  登录方式:",
    "en": "  Sign-in method:"
  },
  "扫码登录（无需密码，推荐）": {
    "zh-CN": "扫码登录（无需密码，推荐）",
    "en": "Scan QR code (no password; recommended)"
  },
  "密码登录": {
    "zh-CN": "密码登录",
    "en": "Password"
  },
  "  QQ 密码:": {
    "zh-CN": "  QQ 密码:",
    "en": "  QQ password:"
  },
  "密码不能为空": {
    "zh-CN": "密码不能为空",
    "en": "Password is required"
  },
  "  登录设备平台:": {
    "zh-CN": "  登录设备平台:",
    "en": "  Device platform:"
  },
  "Android 手机（默认）": {
    "zh-CN": "Android 手机（默认）",
    "en": "Android phone (default)"
  },
  "Android 平板 (aPad)": {
    "zh-CN": "Android 平板 (aPad)",
    "en": "Android tablet (aPad)"
  },
  "Android 手表 (Watch)": {
    "zh-CN": "Android 手表 (Watch)",
    "en": "Android watch (Watch)"
  },
  "  签名服务器地址（留空则尝试用本地 @icqqjs/qqsign）:": {
    "zh-CN": "  签名服务器地址（留空则尝试用本地 @icqqjs/qqsign）:",
    "en": "  Signing server URL (leave blank to try local @icqqjs/qqsign):"
  },
  "  配置高级选项（数据目录、QQNT、协议版本等）？": {
    "zh-CN": "  配置高级选项（数据目录、QQNT、协议版本等）？",
    "en": "  Configure advanced options (data directory, QQNT, protocol version)?"
  },
  "  协议版本号（留空使用9.1.70）:": {
    "zh-CN": "  协议版本号（留空使用9.1.70）:",
    "en": "  Protocol version (leave blank for 9.1.70):"
  },
  "  数据存储目录（留空使用默认）:": {
    "zh-CN": "  数据存储目录（留空使用默认）:",
    "en": "  Data directory (leave blank for default):"
  },
  "  使用 QQNT 协议？": {
    "zh-CN": "  使用 QQNT 协议？",
    "en": "  Use the QQNT protocol?"
  },
  "  缓存群员列表？（群多时占内存较大）": {
    "zh-CN": "  缓存群员列表？（群多时占内存较大）",
    "en": "  Cache group member lists? (uses more memory with many groups)"
  },
  "     需最新版微信 + ClawBot 灰度资格（仅私聊）": {
    "zh-CN": "     需最新版微信 + ClawBot 灰度资格（仅私聊）",
    "en": "     Requires the latest WeChat and ClawBot rollout eligibility (private messages only)"
  },
  "扫码绑定（微信 ClawBot 入口扫码，自动获取 bot_token）": {
    "zh-CN": "扫码绑定（微信 ClawBot 入口扫码，自动获取 bot_token）",
    "en": "Scan QR code (WeChat ClawBot entry; obtains bot_token automatically)"
  },
  "手动输入 bot_token": {
    "zh-CN": "手动输入 bot_token",
    "en": "Enter bot_token manually"
  },
  "     扫码未完成，降级为手动输入 bot_token": {
    "zh-CN": "     扫码未完成，降级为手动输入 bot_token",
    "en": "     QR sign-in was not completed; switching to manual bot_token entry"
  },
  "     请用微信扫描上方二维码（或打开链接完成绑定）:": {
    "zh-CN": "     请用微信扫描上方二维码（或打开链接完成绑定）:",
    "en": "     Scan the QR code in WeChat, or open this link to complete binding:"
  },
  "     已扫码，请在微信中确认…": {
    "zh-CN": "     已扫码，请在微信中确认…",
    "en": "     Code scanned. Confirm in WeChat…"
  },
  "     绑定成功，bot_token 已写入 .env（WEIXIN_ILINK_TOKEN）": {
    "zh-CN": "     绑定成功，bot_token 已写入 .env（WEIXIN_ILINK_TOKEN）",
    "en": "     Binding succeeded; bot_token was added to the .env draft (WEIXIN_ILINK_TOKEN)"
  },
  "     扫码登录失败：{v0}": {
    "zh-CN": "     扫码登录失败：{v0}",
    "en": "     QR sign-in failed: {v0}"
  },
  "  重新获取二维码再试一次？（选否则手动输入 token）": {
    "zh-CN": "  重新获取二维码再试一次？（选否则手动输入 token）",
    "en": "  Fetch a new QR code and try again? (No switches to manual token entry)"
  },
  "Sandbox (调试沙盒，默认)": {
    "zh-CN": "Sandbox (调试沙盒，默认)",
    "en": "Sandbox (local debugging; default)"
  },
  "终端 + Remote Console 沙盒页，本地开发首选": {
    "zh-CN": "终端 + Remote Console 沙盒页，本地开发首选",
    "en": "Terminal and Remote Console sandbox; recommended for local development"
  },
  "无需额外凭据；pnpm dev（zhin runtime start）后可在 Console 沙盒页直接对话。": {
    "zh-CN": "无需额外凭据；pnpm dev（zhin runtime start）后可在 Console 沙盒页直接对话。",
    "en": "No additional credentials; after pnpm dev (zhin runtime start), chat directly on the Console sandbox page."
  },
  "非官方 QQ 协议，直连 @icqqjs/icqq": {
    "zh-CN": "非官方 QQ 协议，直连 @icqqjs/icqq",
    "en": "Unofficial QQ protocol via @icqqjs/icqq"
  },
  "直连 @icqqjs/icqq 协议库，支持扫码或密码登录；建议配置签名服务以提高稳定性。": {
    "zh-CN": "直连 @icqqjs/icqq 协议库，支持扫码或密码登录；建议配置签名服务以提高稳定性。",
    "en": "Connects through @icqqjs/icqq with QR or password sign-in; a signing service is recommended for reliability."
  },
  "QQ 官方": {
    "zh-CN": "QQ 官方",
    "en": "QQ Official"
  },
  "QQ 开放平台官方 Bot": {
    "zh-CN": "QQ 开放平台官方 Bot",
    "en": "Official Bot for QQ Open Platform"
  },
  "在 q.qq.com/bot 创建机器人，获取 AppID / Token / Secret；mode 选 public 或 private。": {
    "zh-CN": "在 q.qq.com/bot 创建机器人，获取 AppID / Token / Secret；mode 选 public 或 private。",
    "en": "Create a bot at q.qq.com/bot and obtain AppID / Token / Secret; select public or private mode."
  },
  "KOOK 语音平台 Endpoint": {
    "zh-CN": "KOOK 语音平台 Endpoint",
    "en": "KOOK voice platform Endpoint"
  },
  "在 KOOK 开发者中心创建 Endpoint 并复制 Token；需配置 Webhook 回调地址（公网或内网穿透）。": {
    "zh-CN": "在 KOOK 开发者中心创建 Endpoint 并复制 Token；需配置 Webhook 回调地址（公网或内网穿透）。",
    "en": "Create an Endpoint in KOOK Developer Center and copy its Token; configure a webhook callback URL (public or tunneled)."
  },
  "Discord（Gateway 或 Interactions）": {
    "zh-CN": "Discord（Gateway 或 Interactions）",
    "en": "Discord (Gateway or Interactions)"
  },
  "Developer Portal 创建 Bot；Gateway 用 Token，Interactions 需 Application ID + Public Key。": {
    "zh-CN": "Developer Portal 创建 Bot；Gateway 用 Token，Interactions 需 Application ID + Public Key。",
    "en": "Create a Bot in Developer Portal; Gateway uses a Token, while Interactions requires Application ID and Public Key."
  },
  "Telegram Bot（polling / webhook 可选）": {
    "zh-CN": "Telegram Bot（polling / webhook 可选）",
    "en": "Telegram Bot (polling or webhook)"
  },
  "@BotFather 获取 Token；polling 适合本地，webhook 需 HTTPS 公网域名。": {
    "zh-CN": "@BotFather 获取 Token；polling 适合本地，webhook 需 HTTPS 公网域名。",
    "en": "Get a Token from @BotFather; polling suits local development, while webhook requires a public HTTPS domain."
  },
  "Slack（Socket Mode 或 HTTP Events）": {
    "zh-CN": "Slack（Socket Mode 或 HTTP Events）",
    "en": "Slack (Socket Mode or HTTP Events)"
  },
  "Socket Mode 无需公网；HTTP 模式需配置 Event Subscriptions URL。": {
    "zh-CN": "Socket Mode 无需公网；HTTP 模式需配置 Event Subscriptions URL。",
    "en": "Socket Mode needs no public URL; HTTP mode requires an Event Subscriptions URL."
  },
  "钉钉": {
    "zh-CN": "钉钉",
    "en": "DingTalk"
  },
  "钉钉企业内部应用 / 机器人": {
    "zh-CN": "钉钉企业内部应用 / 机器人",
    "en": "DingTalk internal application / bot"
  },
  "在钉钉开放平台创建应用，配置机器人并设置 HTTP 回调 URL（需公网可达）。": {
    "zh-CN": "在钉钉开放平台创建应用，配置机器人并设置 HTTP 回调 URL（需公网可达）。",
    "en": "Create an application on DingTalk Open Platform, configure the bot, and set a publicly reachable HTTP callback URL."
  },
  "Webhook 路径:": {
    "zh-CN": "Webhook 路径:",
    "en": "Webhook path:"
  },
  "飞书": {
    "zh-CN": "飞书",
    "en": "Lark"
  },
  "飞书 / Lark 企业应用": {
    "zh-CN": "飞书 / Lark 企业应用",
    "en": "Feishu / Lark enterprise application"
  },
  "在飞书开放平台创建企业自建应用，启用机器人并配置事件订阅 URL（需公网可达）。": {
    "zh-CN": "在飞书开放平台创建企业自建应用，启用机器人并配置事件订阅 URL（需公网可达）。",
    "en": "Create an enterprise application on Feishu Open Platform, enable the bot, and configure a publicly reachable event subscription URL."
  },
  "在 LINE Developers Console 创建 Messaging API Channel；Webhook URL 需 HTTPS 公网可达，并关闭 Auto-reply。": {
    "zh-CN": "在 LINE Developers Console 创建 Messaging API Channel；Webhook URL 需 HTTPS 公网可达，并关闭 Auto-reply。",
    "en": "Create a Messaging API Channel in LINE Developers Console; the Webhook URL must be publicly reachable over HTTPS. Disable Auto-reply."
  },
  "OneBot v11（ws 正向 / wss 反向）": {
    "zh-CN": "OneBot v11（ws 正向 / wss 反向）",
    "en": "OneBot v11 (forward ws / reverse wss)"
  },
  "connection: ws 连 OneBot 实现；connection: wss 反向连接（由内置 HTTP Host 承接）。": {
    "zh-CN": "connection: ws 连 OneBot 实现；connection: wss 反向连接（由内置 HTTP Host 承接）。",
    "en": "connection: ws connects to the OneBot implementation; connection: wss accepts reverse connections through the built-in HTTP Host."
  },
  "connection: ws 连 OneBot 实现；webhook / wss 由内置 HTTP Host 承接。": {
    "zh-CN": "connection: ws 连 OneBot 实现；webhook / wss 由内置 HTTP Host 承接。",
    "en": "connection: ws connects to the OneBot implementation; webhook / wss use the built-in HTTP Host."
  },
  "NapCat（OneBot 11 + NapCat 扩展）": {
    "zh-CN": "NapCat（OneBot 11 + NapCat 扩展）",
    "en": "NapCat (OneBot 11 and NapCat extensions)"
  },
  "connection: ws 连 NapCat（默认 ws://127.0.0.1:3001）；wss / http 由内置 HTTP Host 承接。": {
    "zh-CN": "connection: ws 连 NapCat（默认 ws://127.0.0.1:3001）；wss / http 由内置 HTTP Host 承接。",
    "en": "connection: ws connects to NapCat (default ws://127.0.0.1:3001); wss / http use the built-in HTTP Host."
  },
  "Milky 协议（ws / sse / webhook / wss）": {
    "zh-CN": "Milky 协议（ws / sse / webhook / wss）",
    "en": "Milky protocol (ws / sse / webhook / wss)"
  },
  "connection: ws 连协议端 ws(s)://baseUrl/event；webhook / wss 由内置 HTTP Host 承接。": {
    "zh-CN": "connection: ws 连协议端 ws(s)://baseUrl/event；webhook / wss 由内置 HTTP Host 承接。",
    "en": "connection: ws connects to ws(s)://baseUrl/event; webhook / wss use the built-in HTTP Host."
  },
  "Satori 聊天协议（ws / webhook）": {
    "zh-CN": "Satori 聊天协议（ws / webhook）",
    "en": "Satori chat protocol (ws / webhook)"
  },
  "connection: ws 连 Satori SDK（默认 http://127.0.0.1:5140）；webhook 由内置 HTTP Host 承接。": {
    "zh-CN": "connection: ws 连 Satori SDK（默认 http://127.0.0.1:5140）；webhook 由内置 HTTP Host 承接。",
    "en": "connection: ws connects to the Satori SDK (default http://127.0.0.1:5140); webhook uses the built-in HTTP Host."
  },
  "微信公众号": {
    "zh-CN": "微信公众号",
    "en": "WeChat Official Account"
  },
  "微信公众平台（服务号/订阅号）": {
    "zh-CN": "微信公众平台（服务号/订阅号）",
    "en": "WeChat Official Accounts (service / subscription)"
  },
  "在微信公众平台配置服务器 URL 与 Token；需备案域名且公网 HTTPS 可达。": {
    "zh-CN": "在微信公众平台配置服务器 URL 与 Token；需备案域名且公网 HTTPS 可达。",
    "en": "Configure the server URL and Token on WeChat Official Platform; use a registered domain reachable over public HTTPS."
  },
  "验证 Token:": {
    "zh-CN": "验证 Token:",
    "en": "Verification Token:"
  },
  "企业微信": {
    "zh-CN": "企业微信",
    "en": "WeCom"
  },
  "企业微信自建应用": {
    "zh-CN": "企业微信自建应用",
    "en": "WeCom internal application"
  },
  "管理后台创建自建应用并配置「接收消息」URL（需公网可达）；Token / EncodingAESKey 与后台一致。": {
    "zh-CN": "管理后台创建自建应用并配置「接收消息」URL（需公网可达）；Token / EncodingAESKey 与后台一致。",
    "en": "Create an internal application and configure its publicly reachable receive-message URL; Token / EncodingAESKey must match the admin settings."
  },
  "应用 Secret:": {
    "zh-CN": "应用 Secret:",
    "en": "Application Secret:"
  },
  "回调 Token:": {
    "zh-CN": "回调 Token:",
    "en": "Callback Token:"
  },
  "EncodingAESKey（43 字符）:": {
    "zh-CN": "EncodingAESKey（43 字符）:",
    "en": "EncodingAESKey (43 characters):"
  },
  "回调路径:": {
    "zh-CN": "回调路径:",
    "en": "Callback path:"
  },
  "SMTP 发信 + IMAP 收信": {
    "zh-CN": "SMTP 发信 + IMAP 收信",
    "en": "SMTP sending and IMAP receiving"
  },
  "使用邮箱 SMTP/IMAP 凭据；QQ/163 等需开启授权码而非登录密码。": {
    "zh-CN": "使用邮箱 SMTP/IMAP 凭据；QQ/163 等需开启授权码而非登录密码。",
    "en": "Use SMTP/IMAP credentials; QQ/163 and similar providers require an app authorization code instead of the sign-in password."
  },
  "SMTP 服务器:": {
    "zh-CN": "SMTP 服务器:",
    "en": "SMTP server:"
  },
  "SMTP 端口:": {
    "zh-CN": "SMTP 端口:",
    "en": "SMTP port:"
  },
  "未找到 Root YAML/JSON 配置文件": {
    "zh-CN": "未找到 Root YAML/JSON 配置文件",
    "en": "No root YAML/JSON configuration file found"
  },
  "{v0} 暂不支持自动写入": {
    "zh-CN": "{v0} 暂不支持自动写入",
    "en": "Automatic writes are not supported for {v0}"
  },
  "{v0}；请先运行 zhin migrate": {
    "zh-CN": "{v0}；请先运行 zhin migrate",
    "en": "{v0}; run zhin migrate first"
  },
  "配置无需改动。": {
    "zh-CN": "配置无需改动。",
    "en": "No configuration changes needed."
  },
  "配置已在预览后发生变更，请重新生成配置计划。": {
    "zh-CN": "配置已在预览后发生变更，请重新生成配置计划。",
    "en": "Configuration changed after preview. Generate a new configuration plan."
  },
  "ai@6 与 @ai-sdk/openai-compatible@3（v4 model spec）不兼容，请升级 ai 至 ^7.0.0": {
    "zh-CN": "ai@6 与 @ai-sdk/openai-compatible@3（v4 model spec）不兼容，请升级 ai 至 ^7.0.0",
    "en": "ai@6 is incompatible with @ai-sdk/openai-compatible@3 (v4 model spec); upgrade ai to ^7.0.0"
  },
  "{v0}@{v1} 需要 ai@7（当前 ai@{v2}）": {
    "zh-CN": "{v0}@{v1} 需要 ai@7（当前 ai@{v2}）",
    "en": "{v0}@{v1} requires ai@7 (current: ai@{v2})"
  },
  "# --- L4 可选多模态（取消注释并安装 optional peer）---": {
    "zh-CN": "# --- L4 可选多模态（取消注释并安装 optional peer）---",
    "en": "# --- Optional L4 multimodal support (uncomment and install the optional peer) ---"
  },
  "#       strategy: transcribe   # 需 @zhin.js/speech": {
    "zh-CN": "#       strategy: transcribe   # 需 @zhin.js/speech",
    "en": "#       strategy: transcribe   # requires @zhin.js/speech"
  },
  "获取登录二维码失败：{v0}": {
    "zh-CN": "获取登录二维码失败：{v0}",
    "en": "Could not fetch sign-in QR code: {v0}"
  },
  "扫码成功但未返回 bot_token，请重试或改用手动输入": {
    "zh-CN": "扫码成功但未返回 bot_token，请重试或改用手动输入",
    "en": "QR confirmation succeeded but no bot_token was returned. Retry or enter it manually."
  },
  "二维码已过期": {
    "zh-CN": "二维码已过期",
    "en": "QR code expired"
  },
  "微信扫码登录超时": {
    "zh-CN": "微信扫码登录超时",
    "en": "WeChat QR sign-in timed out"
  },
  "zhin.js 1.1.x 稳定线才支持当前 @zhin.js/agent 与 AI 安装分层，请升级 zhin.js": {
    "zh-CN": "zhin.js 1.1.x 稳定线才支持当前 @zhin.js/agent 与 AI 安装分层，请升级 zhin.js",
    "en": "The current @zhin.js/agent and optional AI installation tiers require the zhin.js 1.1.x stable line. Upgrade zhin.js."
  },
  "@zhin.js/agent 1.x 与 zhin.js 1.1.x 稳定线 / AI SDK 7 配套，请升级 @zhin.js/agent": {
    "zh-CN": "@zhin.js/agent 1.x 与 zhin.js 1.1.x 稳定线 / AI SDK 7 配套，请升级 @zhin.js/agent",
    "en": "@zhin.js/agent 1.x matches zhin.js 1.1.x stable and AI SDK 7. Upgrade @zhin.js/agent."
  },
  "请输入项目名称:": {
    "zh-CN": "请输入项目名称:",
    "en": "Project name:"
  },
  "项目名称不能为空": {
    "zh-CN": "项目名称不能为空",
    "en": "Project name is required"
  },
  "项目名称只能包含字母、数字、横线和下划线": {
    "zh-CN": "项目名称只能包含字母、数字、横线和下划线",
    "en": "Project name may contain only letters, digits, hyphens and underscores"
  },
  "📋 选择项目模板": {
    "zh-CN": "📋 选择项目模板",
    "en": "📋 Choose a project template"
  },
  "选择模板:": {
    "zh-CN": "选择模板:",
    "en": "Choose a template:"
  },
  "默认 — 最小配置，适合首跑和学习": {
    "zh-CN": "默认 — 最小配置，适合首跑和学习",
    "en": "Default — minimal configuration for a first run and learning"
  },
  "生活助手 — AI 对话 + 知识库 + 记忆 + 定时提醒": {
    "zh-CN": "生活助手 — AI 对话 + 知识库 + 记忆 + 定时提醒",
    "en": "Life assistant — AI chat, knowledge base, memory and reminders"
  },
  "选择运行时:": {
    "zh-CN": "选择运行时:",
    "en": "Choose a runtime:"
  },
  "Node.js (推荐)": {
    "zh-CN": "Node.js (推荐)",
    "en": "Node.js (recommended)"
  },
  "选择配置文件格式:": {
    "zh-CN": "选择配置文件格式:",
    "en": "Choose a configuration format:"
  },
  "YAML (推荐)": {
    "zh-CN": "YAML (推荐)",
    "en": "YAML (recommended)"
  },
  "🔐 配置 Web 控制台访问 Token": {
    "zh-CN": "🔐 配置 Web 控制台访问 Token",
    "en": "🔐 Configure Web Console access Token"
  },
  "Web 控制台 Token (用于 Authorization: Bearer 或 ?token= 认证):": {
    "zh-CN": "Web 控制台 Token (用于 Authorization: Bearer 或 ?token= 认证):",
    "en": "Web Console Token (Authorization: Bearer or ?token= authentication):"
  },
  "🗄️  配置数据库": {
    "zh-CN": "🗄️  配置数据库",
    "en": "🗄️  Configure database"
  },
  "🌍 全局 CLI 安装": {
    "zh-CN": "🌍 全局 CLI 安装",
    "en": "🌍 Global CLI installation"
  },
  "这将允许你在任何目录下使用 \"zhin\" 命令": {
    "zh-CN": "这将允许你在任何目录下使用 \"zhin\" 命令",
    "en": "This makes the \"zhin\" command available from any directory"
  },
  "是否全局安装 @zhin.js/cli 命令行工具？": {
    "zh-CN": "是否全局安装 @zhin.js/cli 命令行工具？",
    "en": "Install @zhin.js/cli globally?"
  },
  "🛠️  Zhin 插件开发技能": {
    "zh-CN": "🛠️  Zhin 插件开发技能",
    "en": "🛠️  Zhin plugin development skills"
  },
  "安装一组 AI 技能，帮助你通过 AI 助手高质量地开发、测试和发布 Zhin 插件": {
    "zh-CN": "安装一组 AI 技能，帮助你通过 AI 助手高质量地开发、测试和发布 Zhin 插件",
    "en": "Install AI skills to help develop, test and publish Zhin plugins"
  },
  "包含：插件初始化、功能开发、测试编写、质量审查、发布指南": {
    "zh-CN": "包含：插件初始化、功能开发、测试编写、质量审查、发布指南",
    "en": "Includes: plugin initialization, development, tests, quality review and publishing"
  },
  "是否安装 Zhin 插件开发技能？（推荐）": {
    "zh-CN": "是否安装 Zhin 插件开发技能？（推荐）",
    "en": "Install Zhin plugin development skills? (recommended)"
  },
  "目录 {v0} 已存在": {
    "zh-CN": "目录 {v0} 已存在",
    "en": "Directory {v0} already exists"
  },
  "正在创建 pnpm workspace 项目 {v0}...": {
    "zh-CN": "正在创建 pnpm workspace 项目 {v0}...",
    "en": "Creating pnpm workspace project {v0}..."
  },
  "✓ 项目结构创建成功！": {
    "zh-CN": "✓ 项目结构创建成功！",
    "en": "✓ Project structure created!"
  },
  "📦 正在安装依赖...": {
    "zh-CN": "📦 正在安装依赖...",
    "en": "📦 Installing dependencies..."
  },
  "已跳过安装；进入项目后运行 pnpm install，再运行 pnpm dev。": {
    "zh-CN": "已跳过安装；进入项目后运行 pnpm install，再运行 pnpm dev。",
    "en": "Installation skipped. Run pnpm install in the project, then pnpm dev."
  },
  "🎉 项目初始化完成！": {
    "zh-CN": "🎉 项目初始化完成！",
    "en": "🎉 Project initialized!"
  },
  "🔐 Remote Console 登录信息：": {
    "zh-CN": "🔐 Remote Console 登录信息：",
    "en": "🔐 Remote Console sign-in details:"
  },
  "打开 Console 后进入 Sandbox / 沙盒页，连接后发送 /hello": {
    "zh-CN": "打开 Console 后进入 Sandbox / 沙盒页，连接后发送 /hello",
    "en": "Open the Console Sandbox page, connect, and send /hello"
  },
  "⚠ Token 已保存到": {
    "zh-CN": "⚠ Token 已保存到",
    "en": "⚠ Token saved to"
  },
  "文件，用于 Bearer Token 或 Console 登录页": {
    "zh-CN": "文件，用于 Bearer Token 或 Console 登录页",
    "en": "for Bearer Token authentication or the Console sign-in page"
  },
  "🗄️  数据库配置：": {
    "zh-CN": "🗄️  数据库配置：",
    "en": "🗄️  Database configuration:"
  },
  "类型:": {
    "zh-CN": "类型:",
    "en": "Type:"
  },
  "文件:": {
    "zh-CN": "文件:",
    "en": "File:"
  },
  "模式:": {
    "zh-CN": "模式:",
    "en": "Mode:"
  },
  "⚠ 仅用于测试，进程退出后数据不会保留": {
    "zh-CN": "⚠ 仅用于测试，进程退出后数据不会保留",
    "en": "⚠ For testing only; data is lost when the process exits"
  },
  "⚠ 数据库连接信息已保存到": {
    "zh-CN": "⚠ 数据库连接信息已保存到",
    "en": "⚠ Database connection details saved to"
  },
  "文件": {
    "zh-CN": "文件",
    "en": "file"
  },
  "请根据实际情况修改数据库连接参数": {
    "zh-CN": "请根据实际情况修改数据库连接参数",
    "en": "Adjust the connection parameters for your database"
  },
  "启动前校验:": {
    "zh-CN": "启动前校验:",
    "en": "Validate before starting:"
  },
  "🔌 已配置适配器：": {
    "zh-CN": "🔌 已配置适配器：",
    "en": "🔌 Configured adapters:"
  },
  "⚠ 适配器凭据已保存到": {
    "zh-CN": "⚠ 适配器凭据已保存到",
    "en": "⚠ Adapter credentials saved to"
  },
  "  后续步骤：": {
    "zh-CN": "  后续步骤：",
    "en": "  Next steps:"
  },
  "🤖 AI 智能体配置：": {
    "zh-CN": "🤖 AI 智能体配置：",
    "en": "🤖 AI Agent configuration:"
  },
  "提供商:": {
    "zh-CN": "提供商:",
    "en": "Provider:"
  },
  "@机器人": {
    "zh-CN": "@机器人",
    "en": "Bot mention"
  },
  "私聊": {
    "zh-CN": "私聊",
    "en": "Private messages"
  },
  "前缀 {v0}": {
    "zh-CN": "前缀 {v0}",
    "en": "Prefix {v0}"
  },
  "触发方式:": {
    "zh-CN": "触发方式:",
    "en": "Triggers:"
  },
  "会话/上下文:": {
    "zh-CN": "会话/上下文:",
    "en": "Sessions/context:"
  },
  "已启用推荐默认值": {
    "zh-CN": "已启用推荐默认值",
    "en": "Recommended defaults enabled"
  },
  "执行安全:": {
    "zh-CN": "执行安全:",
    "en": "Execution security:"
  },
  "已启用": {
    "zh-CN": "已启用",
    "en": "Enabled"
  },
  "依赖:": {
    "zh-CN": "依赖:",
    "en": "Dependencies:"
  },
  "会话存储:": {
    "zh-CN": "会话存储:",
    "en": "Session storage:"
  },
  "⚠ API Key 已保存到": {
    "zh-CN": "⚠ API Key 已保存到",
    "en": "⚠ API Key saved to"
  },
  "文件（AI_API_KEY）": {
    "zh-CN": "文件（AI_API_KEY）",
    "en": "(AI_API_KEY)"
  },
  "  {v0} 请确保 Ollama 已启动且模型已 pull": {
    "zh-CN": "  {v0} 请确保 Ollama 已启动且模型已 pull",
    "en": "  {v0} Make sure Ollama is running and the model has been pulled"
  },
  "提示:": {
    "zh-CN": "提示:",
    "en": "Tip:"
  },
  "🛠️  插件开发技能：": {
    "zh-CN": "🛠️  插件开发技能：",
    "en": "🛠️  Plugin development skills:"
  },
  "初始化插件项目结构": {
    "zh-CN": "初始化插件项目结构",
    "en": "Initialize plugin project structure"
  },
  "开发插件功能（命令、中间件、AI 工具等）": {
    "zh-CN": "开发插件功能（命令、中间件、AI 工具等）",
    "en": "Develop plugin features (commands, middleware, AI tools, etc.)"
  },
  "编写和运行测试用例": {
    "zh-CN": "编写和运行测试用例",
    "en": "Write and run tests"
  },
  "代码质量审查与规范检查": {
    "zh-CN": "代码质量审查与规范检查",
    "en": "Review code quality and conventions"
  },
  "发布到 npm 和插件市场": {
    "zh-CN": "发布到 npm 和插件市场",
    "en": "Publish to npm and the plugin marketplace"
  },
  "位置:": {
    "zh-CN": "位置:",
    "en": "Location:"
  },
  "目录": {
    "zh-CN": "目录",
    "en": "directory"
  },
  "📝 下一步操作：": {
    "zh-CN": "📝 下一步操作：",
    "en": "📝 Next steps:"
  },
  "# zhin runtime start，然后打开 Console 的 Sandbox 页发送 /hello": {
    "zh-CN": "# zhin runtime start，然后打开 Console 的 Sandbox 页发送 /hello",
    "en": "# zhin runtime start, then send /hello on the Console Sandbox page"
  },
  "下一步（任选）：": {
    "zh-CN": "下一步（任选）：",
    "en": "Next steps (choose any):"
  },
  "接 QQ/Discord": {
    "zh-CN": "接 QQ/Discord",
    "en": "Connect QQ/Discord"
  },
  "启用 AI 对话": {
    "zh-CN": "启用 AI 对话",
    "en": "Enable AI chat"
  },
  "写插件": {
    "zh-CN": "写插件",
    "en": "Write a plugin"
  },
  "(文档 https://zhin.js.org/getting-started/first-plugin)": {
    "zh-CN": "(文档 https://zhin.js.org/getting-started/first-plugin)",
    "en": "(Documentation: https://zhin.js.org/getting-started/first-plugin)"
  },
  "诊断": {
    "zh-CN": "诊断",
    "en": "Diagnostics"
  },
  "# SQLite 使用 Node 内置 node:sqlite，请使用 Node.js 22.5+（推荐 24+）": {
    "zh-CN": "# SQLite 使用 Node 内置 node:sqlite，请使用 Node.js 22.5+（推荐 24+）",
    "en": "# SQLite uses built-in Node.js node:sqlite; use Node.js 22.5+ (24+ recommended)"
  },
  "✓ 已为你配置全局 CLI": {
    "zh-CN": "✓ 已为你配置全局 CLI",
    "en": "✓ Global CLI configured"
  },
  "# 执行一次以链接全局 CLI": {
    "zh-CN": "# 执行一次以链接全局 CLI",
    "en": "# Run once to link the global CLI"
  },
  "开发环境：": {
    "zh-CN": "开发环境：",
    "en": "Development:"
  },
  "# 或 pnpm dev - 开发模式（自动监听，支持热重载）": {
    "zh-CN": "# 或 pnpm dev - 开发模式（自动监听，支持热重载）",
    "en": "# Or pnpm dev - development mode with file watching and hot reload"
  },
  "# 检查 Console / Host / Sandbox / 依赖状态": {
    "zh-CN": "# 检查 Console / Host / Sandbox / 依赖状态",
    "en": "# Check Console / Host / Sandbox / dependencies"
  },
  "生产环境：": {
    "zh-CN": "生产环境：",
    "en": "Production:"
  },
  "# 或 pnpm start - 前台运行": {
    "zh-CN": "# 或 pnpm start - 前台运行",
    "en": "# Or pnpm start - foreground mode"
  },
  "PM2 进程管理（推荐生产环境）：": {
    "zh-CN": "PM2 进程管理（推荐生产环境）：",
    "en": "PM2 process management (recommended for production):"
  },
  "# 启动 PM2 守护进程": {
    "zh-CN": "# 启动 PM2 守护进程",
    "en": "# Start the PM2 daemon"
  },
  "# 停止服务": {
    "zh-CN": "# 停止服务",
    "en": "# Stop the service"
  },
  "# 重启服务": {
    "zh-CN": "# 重启服务",
    "en": "# Restart the service"
  },
  "# 查看日志": {
    "zh-CN": "# 查看日志",
    "en": "# View logs"
  },
  "插件开发：": {
    "zh-CN": "插件开发：",
    "en": "Plugin development:"
  },
  "# 创建项目内插件；独立插件加 --standalone": {
    "zh-CN": "# 创建项目内插件；独立插件加 --standalone",
    "en": "# Create a project-local plugin; add --standalone for an independent plugin"
  },
  "💡 使用 pnpm 和 npx 运行命令：": {
    "zh-CN": "💡 使用 pnpm 和 npx 运行命令：",
    "en": "💡 Run commands with pnpm and npx:"
  },
  "# 或 npx zhin runtime start - 开发模式（自动监听，支持热重载）": {
    "zh-CN": "# 或 npx zhin runtime start - 开发模式（自动监听，支持热重载）",
    "en": "# Or npx zhin runtime start - development mode with file watching and hot reload"
  },
  "# 或 npx zhin runtime start --mode production --no-watch - 前台运行": {
    "zh-CN": "# 或 npx zhin runtime start --mode production --no-watch - 前台运行",
    "en": "# Or npx zhin runtime start --mode production --no-watch - foreground mode"
  },
  "💡 后续如需全局安装 CLI，可运行：": {
    "zh-CN": "💡 后续如需全局安装 CLI，可运行：",
    "en": "💡 To install the CLI globally later:"
  },
  "# 在项目根目录执行，链接全局 CLI": {
    "zh-CN": "# 在项目根目录执行，链接全局 CLI",
    "en": "# Run in the project root to link the global CLI"
  },
  "📚 相关文档：": {
    "zh-CN": "📚 相关文档：",
    "en": "📚 Documentation:"
  },
  "创建项目失败: {v0}": {
    "zh-CN": "创建项目失败: {v0}",
    "en": "Could not create project: {v0}"
  },
  "✓ 检测到 pnpm 已安装": {
    "zh-CN": "✓ 检测到 pnpm 已安装",
    "en": "✓ pnpm is installed"
  },
  "⚠ 未检测到 pnpm，正在自动安装...": {
    "zh-CN": "⚠ 未检测到 pnpm，正在自动安装...",
    "en": "⚠ pnpm not found; installing automatically..."
  },
  "正在执行: npm install -g pnpm": {
    "zh-CN": "正在执行: npm install -g pnpm",
    "en": "Running: npm install -g pnpm"
  },
  "✓ pnpm 安装成功！": {
    "zh-CN": "✓ pnpm 安装成功！",
    "en": "✓ pnpm installed!"
  },
  "✗ pnpm 安装失败，请手动安装:": {
    "zh-CN": "✗ pnpm 安装失败，请手动安装:",
    "en": "✗ pnpm installation failed. Install manually:"
  },
  "错误详情: {v0}": {
    "zh-CN": "错误详情: {v0}",
    "en": "Error details: {v0}"
  },
  "或访问: https://pnpm.io/installation": {
    "zh-CN": "或访问: https://pnpm.io/installation",
    "en": "Or visit: https://pnpm.io/installation"
  },
  "执行: pnpm install": {
    "zh-CN": "执行: pnpm install",
    "en": "Running: pnpm install"
  },
  "✓ 依赖安装成功！": {
    "zh-CN": "✓ 依赖安装成功！",
    "en": "✓ Dependencies installed!"
  },
  "⚠ 依赖安装失败": {
    "zh-CN": "⚠ 依赖安装失败",
    "en": "⚠ Dependency installation failed"
  },
  "你可以稍后手动安装:": {
    "zh-CN": "你可以稍后手动安装:",
    "en": "Install manually later:"
  },
  "🩺 安装后自检（zhin doctor）...": {
    "zh-CN": "🩺 安装后自检（zhin doctor）...",
    "en": "🩺 Post-install check (zhin doctor)..."
  },
  "⚠ 自检发现问题（见上方 ❌/⚠️），可按提示修复后重新运行:": {
    "zh-CN": "⚠ 自检发现问题（见上方 ❌/⚠️），可按提示修复后重新运行:",
    "en": "⚠ The check found issues (see ❌/⚠️ above). Follow the guidance and rerun:"
  },
  "bytes 必须大于 0": {
    "zh-CN": "bytes 必须大于 0",
    "en": "bytes must be greater than 0"
  },
  "********（{v0} 位，已隐藏）": {
    "zh-CN": "********（{v0} 位，已隐藏）",
    "en": "******** ({v0} characters; hidden)"
  },
  "{v0}，完整值见项目根目录 .env 的 HTTP_TOKEN": {
    "zh-CN": "{v0}，完整值见项目根目录 .env 的 HTTP_TOKEN",
    "en": "{v0}; find the full HTTP_TOKEN in the project-root .env"
  },
  "Memory（仅进程内，不持久化）": {
    "zh-CN": "Memory（仅进程内，不持久化）",
    "en": "Memory (in-process; not persistent)"
  },
  "{v0} 持久化": {
    "zh-CN": "{v0} 持久化",
    "en": "{v0} persistence"
  },
  "📝 设置引导文件": {
    "zh-CN": "📝 设置引导文件",
    "en": "📝 Set up bootstrap files"
  },
  "AI 人格定义": {
    "zh-CN": "AI 人格定义",
    "en": "AI persona"
  },
  "工具使用指南": {
    "zh-CN": "工具使用指南",
    "en": "Tool usage guide"
  },
  "Agent 长期记忆": {
    "zh-CN": "Agent 长期记忆",
    "en": "Agent long-term memory"
  },
  "{v0} 已存在，是否覆盖？": {
    "zh-CN": "{v0} 已存在，是否覆盖？",
    "en": "{v0} already exists. Overwrite?"
  },
  "  跳过 {v0}": {
    "zh-CN": "  跳过 {v0}",
    "en": "  Skipped {v0}"
  },
  "  ✓ 创建 {v0} - {v1}": {
    "zh-CN": "  ✓ 创建 {v0} - {v1}",
    "en": "  ✓ Created {v0} - {v1}"
  },
  "交互式配置向导": {
    "zh-CN": "交互式配置向导",
    "en": "Interactive configuration wizard"
  },
  "项目语言 / Project language (zh-CN, en)": {
    "zh-CN": "项目语言 / Project language (zh-CN, en)",
    "en": "Project language (zh-CN, en)"
  },
  "在 ~/.zhin 初始化并配置全局实例": {
    "zh-CN": "在 ~/.zhin 初始化并配置全局实例",
    "en": "Initialize and configure a global instance in ~/.zhin"
  },
  "仅配置引导文件": {
    "zh-CN": "仅配置引导文件",
    "en": "Configure bootstrap files only"
  },
  "仅配置数据库": {
    "zh-CN": "仅配置数据库",
    "en": "Configure database only"
  },
  "仅配置适配器": {
    "zh-CN": "仅配置适配器",
    "en": "Configure adapters only"
  },
  "仅配置 AI": {
    "zh-CN": "仅配置 AI",
    "en": "Configure AI only"
  },
  "配置可选 TypeSafe Jev 决策服务（需要已有 AI 配置）": {
    "zh-CN": "配置可选 TypeSafe Jev 决策服务（需要已有 AI 配置）",
    "en": "Configure the optional TypeSafe Jev decision service (requires existing AI configuration)"
  },
  "无法初始化全局实例目录 {v0}": {
    "zh-CN": "无法初始化全局实例目录 {v0}",
    "en": "Could not initialize the global instance directory {v0}"
  },
  "当前目录不是有效的 Zhin 项目，请先使用 {v0} 创建项目，或 zhin setup --global": {
    "zh-CN": "当前目录不是有效的 Zhin 项目，请先使用 {v0} 创建项目，或 zhin setup --global",
    "en": "This is not a valid Zhin project. Create one with {v0}, or run zhin setup --global."
  },
  "\n🌐 Zhin 全局实例（{v0}）\n": {
    "zh-CN": "\n🌐 Zhin 全局实例（{v0}）\n",
    "en": "\n🌐 Zhin global instance ({v0})\n"
  },
  "\n🚀 Zhin 配置向导\n": {
    "zh-CN": "\n🚀 Zhin 配置向导\n",
    "en": "\n🚀 Zhin configuration wizard\n"
  },
  "已加载配置文件: {v0}\n": {
    "zh-CN": "已加载配置文件: {v0}\n",
    "en": "Loaded configuration: {v0}\n"
  },
  "未找到配置文件，将创建 zhin.config.yml\n": {
    "zh-CN": "未找到配置文件，将创建 zhin.config.yml\n",
    "en": "No configuration file found; creating zhin.config.yml\n"
  },
  "  ✓ 已配置 TypeSafe 决策服务；稍后自动安装全局实例依赖。": {
    "zh-CN": "  ✓ 已配置 TypeSafe 决策服务；稍后自动安装全局实例依赖。",
    "en": "  ✓ TypeSafe decision service configured; global-instance dependencies will be installed next."
  },
  "  ✓ 已配置 TypeSafe 决策服务；运行 pnpm install 后启动。": {
    "zh-CN": "  ✓ 已配置 TypeSafe 决策服务；运行 pnpm install 后启动。",
    "en": "  ✓ TypeSafe decision service configured; run pnpm install before starting."
  },
  "  ✓ 已更新 package.json 依赖/features 清单，稍后自动安装全局实例依赖。": {
    "zh-CN": "  ✓ 已更新 package.json 依赖/features 清单，稍后自动安装全局实例依赖。",
    "en": "  ✓ package.json dependencies/features updated; global-instance dependencies will be installed next."
  },
  "  ✓ 已更新 package.json 依赖/features 清单，请运行 pnpm install": {
    "zh-CN": "  ✓ 已更新 package.json 依赖/features 清单，请运行 pnpm install",
    "en": "  ✓ package.json dependencies/features updated; run pnpm install"
  },
  "    AI 栈: {v0}": {
    "zh-CN": "    AI 栈: {v0}",
    "en": "    AI stack: {v0}"
  },
  "  适配器后续步骤：": {
    "zh-CN": "  适配器后续步骤：",
    "en": "  Adapter next steps:"
  },
  "✅ 配置已保存": {
    "zh-CN": "✅ 配置已保存",
    "en": "✅ Configuration saved"
  },
  "配置文件: {v0}": {
    "zh-CN": "配置文件: {v0}",
    "en": "Configuration file: {v0}"
  },
  "数据库连接参数已写入 {v0}，配置文件仅保留环境变量引用。": {
    "zh-CN": "数据库连接参数已写入 {v0}，配置文件仅保留环境变量引用。",
    "en": "Database connection parameters were written to {v0}; the configuration contains only environment references."
  },
  "启动前在 {v0} 运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。": {
    "zh-CN": "启动前在 {v0} 运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。",
    "en": "Run npx zhin config check in {v0} before starting. On connection failure, verify the database service, port and target database are reachable."
  },
  "启动前运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。": {
    "zh-CN": "启动前运行 npx zhin config check；如连接失败，请确认数据库服务、端口和目标数据库均可访问。",
    "en": "Run npx zhin config check before starting. On connection failure, verify the database service, port and target database are reachable."
  },
  "正在安装全局实例依赖…": {
    "zh-CN": "正在安装全局实例依赖…",
    "en": "Installing global-instance dependencies…"
  },
  "💡 提示: 任意目录运行 \"zhin runtime start\" 启动全局实例": {
    "zh-CN": "💡 提示: 任意目录运行 \"zhin runtime start\" 启动全局实例",
    "en": "💡 Tip: run \"zhin runtime start\" from any directory to start the global instance"
  },
  "💡 提示: 运行 \"zhin dev\" 启动开发服务器": {
    "zh-CN": "💡 提示: 运行 \"zhin dev\" 启动开发服务器",
    "en": "💡 Tip: run \"zhin dev\" to start the development server"
  },
  "配置失败: {v0}": {
    "zh-CN": "配置失败: {v0}",
    "en": "Configuration failed: {v0}"
  }
} as const;

const render = createMessages(WIZARD_MESSAGES);

/** Explicit locale; never rewrites rendered prompts or registers global language state. */
export function wizardText(locale: Locale | undefined, message: string, values: readonly unknown[] = []): string {
  if (!Object.hasOwn(WIZARD_MESSAGES, message)) return message;
  const parameters: Record<string, string | number> = {};
  // Authored templates can contain literal code/environment placeholders (for example ${TOKEN}).
  // Preserve those exactly; only v0/v1 slots belong to this formatter.
  const source = WIZARD_MESSAGES[message as keyof typeof WIZARD_MESSAGES]['zh-CN'];
  for (const match of source.matchAll(/\{([a-zA-Z][\w]*)\}/gu)) parameters[match[1]!] = match[0];
  values.forEach((value, index) => { parameters[`v${index}`] = String(value); });
  return render(resolveLocale(locale), message as keyof typeof WIZARD_MESSAGES, parameters);
}
