---
title: 模型服务与订阅账号
description: 使用统一的服务、账号和模型配置管理 API Key、OAuth 订阅与结构化决策。
---

# 模型服务与订阅账号

Zhin 将模型设置保存在 Host 数据库中。首次启动时，如果数据库还没有模型配置，根目录的 `ai.plan.yml` 会自动导入作为初始配置；之后在 Console 保存修改后，下一次调用即使用新设置，在途调用保持开始时的选择，无需重启进程。

## 常见厂商 `ai.plan.yml` 速查模板

运行 `npx zhin setup --ai` 可交互生成以下配置。你也可以直接复制对应模板到项目根目录的 `ai.plan.yml`，并在 `.env` 中填入密钥：

::: code-group

```yaml [DeepSeek]
# ai.plan.yml（.env 中设置 DEEPSEEK_API_KEY=sk-...）
version: 1
services:
  deepseek:
    driver: deepseek
    models:
      deepseek-chat:
        id: deepseek-chat
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: deepseek
    auth:
      method: api-key
      source: env://DEEPSEEK_API_KEY
profiles:
  daily:
    account: default
    model: deepseek-chat
purposes:
  chat:
    profile: daily
```

```yaml [OpenAI]
# ai.plan.yml（.env 中设置 OPENAI_API_KEY=sk-...）
version: 1
services:
  openai:
    driver: openai
    models:
      gpt-4o:
        id: gpt-4o
        kinds: [language]
        protocol: openai-chat
        input: [text, image]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: openai
    auth:
      method: api-key
      source: env://OPENAI_API_KEY
profiles:
  daily:
    account: default
    model: gpt-4o
purposes:
  chat:
    profile: daily
```

```yaml [通义千问 / DashScope]
# ai.plan.yml（.env 中设置 DASHSCOPE_API_KEY=sk-...）
version: 1
services:
  dashscope:
    driver: openai-compatible
    options:
      baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    models:
      qwen-plus:
        id: qwen-plus
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  default:
    service: dashscope
    auth:
      method: api-key
      source: env://DASHSCOPE_API_KEY
profiles:
  daily:
    account: default
    model: qwen-plus
purposes:
  chat:
    profile: daily
```

```yaml [本地 Ollama]
# ai.plan.yml（本地免认证连接）
version: 1
services:
  local:
    driver: ollama
    options:
      baseUrl: http://127.0.0.1:11434/v1
    models:
      qwen3:8b:
        id: qwen3:8b
        kinds: [language]
        protocol: openai-chat
        input: [text]
        streaming: true
        toolCalling: true
accounts:
  bot:
    service: local
    auth:
      method: none
profiles:
  daily:
    account: bot
    model: qwen3:8b
    parameters:
      maxOutputTokens: 4096
purposes:
  chat:
    profile: daily
```

:::

## 三个核心对象

- **服务（Service）**：使用哪个 Driver、产品、API 地址，以及该服务的模型目录。
- **账号（Account）**：这个服务上的一个访问身份，采用 API Key（`env://VAR` 或 Console 私有密钥）、OAuth，或本地免认证连接。
- **模型配置（Profile）**：选择账号、原生模型 ID 和生成参数。同一账号可以创建多份 Profile。

聊天（`chat`）、摘要（`compaction`）、旁听（`ambient`）、识图（`perception`）、图片生成（`image`）、Agent 角色和六类结构化决策都通过选择 Profile 绑定，用途本身不复制密钥或 API 地址。详见[个人 Session 与用途选择](./model-policy.md)。

## 在 Console 配置

1. **创建服务（Service）**：填写 Driver 公开表单；添加模型时明确填写协议、调用合同和能力（`input`、`streaming`、`toolCalling`）。
2. **创建账号（Account）**：保存 API Key，或在 Host 订阅账号上开始 OAuth 登录（在供应商页面完成授权后，将最终浏览器回调地址粘贴回 Console；Zhin 不自动启动本地回调监听器）。
3. **创建 Profile 并绑定用途**：将 Profile 分配给 `chat` 等用途。API Key 与 OAuth token 保存在 Host 私有加密记录中，不会出现在 Profile、Session、提示词或普通管理响应里。

## 订阅与 API 协议

| Driver | 认证 | 调用合同 |
| --- | --- | --- |
| `openai` | API Key | OpenAI Chat、Responses、Images |
| `anthropic` | API Key | Anthropic Messages |
| `google` | API Key | Gemini generateContent、Images |
| `deepseek` | API Key | OpenAI Chat |
| `minimax` | API Key | Anthropic Messages、MiniMax Images |
| `cloudflare` | API Key | OpenAI Chat、Cloudflare Images |
| `ollama` | 免认证或 API Key | OpenAI Chat |
| `openai-compatible` | API Key | OpenAI Chat、Images |
| `codex-subscription` | OAuth | Codex Responses |
| `claude-subscription`（实验） | OAuth | Claude 订阅 Messages |
| `opencode-go` / `opencode-zen` | 各产品 API Key | 由服务目录中明确选择的协议决定 |
| `antigravity`（实验） | OAuth | Antigravity generateContent |

Claude 订阅与 Antigravity：实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担。Codex：未经 OpenAI 对第三方客户端的明确授权。

## 插件调用

插件需要直接调用模型时，通过 `aiInferenceClientToken` 获取绑定到当前执行作用域的客户端：

```ts
import { defineCommand } from '@zhin.js/command';
import { aiInferenceClientToken } from '@zhin.js/ai/provider';

export default defineCommand({
  description: 'List available model profiles',
  async execute(context) {
    const models = context.use(aiInferenceClientToken);
    const profiles = await models.list({ kind: 'language' });
    return profiles.map(profile => profile.label ?? profile.reference.id).join('\n');
  },
});
```

Client 由 Host 绑定到本次真实执行作用域，命令／工具结束时自动关闭。只需要一条模型结果时使用 `generate`，流式输出须完整消费或主动关闭。详见[升级与迁移](./provider-upgrade.md)。

::: details 运行时韧性与凭据状态机约束

- **目录与能力声明**：模型名称不证明它支持图片、工具或流式输出。目录刷新是手动操作，返回的上游模型 ID 仍须确认能力后才加入可用目录。一个 Service 可以有多个账号；不会因为请求失败就自动改用另一个账号或模型。
- **实验集成与协议细节**：Console 只为实验集成显示简短标识，在选中详情或登录时显示必要提示。OpenCode Go 与 OpenCode Zen 是分别使用产品 API Key 的服务；套餐、模型和适用场景应按各自产品条款核对，不能套用 Free 产品的条件。Anthropic API Key 与 Claude 订阅、Gemini API Key 与 Antigravity 是独立服务及认证身份。Antigravity 登录后的只读资料／项目准备可以独立重试，不重放已成功的 token 交换。Antigravity 已有隐式缓存命中的实测证据；本轮不把它宣称为原生显式缓存 CRUD。Google Driver 的显式缓存沿用既有内容指纹与目录机制，配置、账号 incarnation、模型／协议或 Driver 变化会隔离状态，普通 token 刷新不使它换号。
- **采样参数与输出上限**：Codex 不接受温度和输出 token 上限，它的 Profile 表单不提供这些字段；明确提交不支持的参数会报错，不静默删除。摘要、旁听、审批不再写入隐藏的温度或输出上限，由选中 Profile 统一决定参数。通用 SDK 未显式设置输出上限时，沿用既有有效预算：模型目录明确声明的上限，否则 8192；这是执行默认，不会写成 Profile 的显式值。
- **凭据表达式与个人连接边界**：Host 管理员可在账号的“设置 API Key”密码框输入单个完整的 `${AI_API_KEY:-默认值}` 或 `${AI_API_KEY:=默认值}`，表达式只保存到私有加密凭据，仅在实际授权时通过 Host 环境存储展开；个人账号不能读取 Host 环境。个人管理界面支持个人 API Key 连接，仅允许 HTTPS 公网目标及同源重定向（Host 自己管理的本地 Ollama 等服务不受此限制）；账号归属由管理员预绑定的真实身份决定，不读取请求正文里的 owner 声明。
- **导入幂等与状态机**：导入文档的字典键是可读别名，不是数据库账号身份。更新已有资源时使用预览提供的明确 bindings；删除后同名新建不继承旧账号、Session 或私人设置。结果未知时保留 mutationId 回查，不换新 ID 重放。
- **结构化决策与 SDK 版本**：结构化决策使用 `decision` Profile，按 `skills`、`tools`、`memory`、`agents`、`approval`、`ambient` 分别选择；`off` 不请求，`shadow` 只记录证据，`active` 才交由业务模块决定应用。普通 `evaluate` 只返回真实 Choice／Score／Noul，不虚构概率，也不把合法弃选当失败。`ai` 最低版本为 `^7.0.35`，用于首个内容 chunk 的超时控制。
:::
