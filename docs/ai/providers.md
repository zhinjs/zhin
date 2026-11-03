---
title: 模型服务与订阅账号
description: 使用统一的服务、账号和模型配置管理 API Key、OAuth 订阅与结构化决策。
---

# 模型服务与订阅账号

Zhin 将模型设置保存在 Host 数据库中。Console 保存修改后，下一次调用使用新设置；在途调用保持开始时的选择，不重启整个进程。

## 三个对象

- **服务（Service）**：使用哪个 Driver、产品、API 地址，以及该服务的模型目录。
- **账号（Account）**：这个服务上的一个访问身份，采用 API Key、OAuth，或本地免认证连接。
- **模型配置（Profile）**：选择账号、原生模型 ID 和生成参数。同一账号可以创建多份 Profile。

聊天、摘要、旁听、识图、图片生成、Agent 角色和六类结构化决策都选择 Profile。用途不复制密钥或 API 地址。一个 Service 可以有多个账号；不会因为请求失败就改用另一个账号或模型。

## 在 Console 配置

先创建服务并填写 Driver 公开表单；添加模型时明确填写协议、调用合同和能力。模型名称不证明它支持图片、工具或流式输出。目录刷新是手动操作，返回的上游模型 ID 仍须确认能力后才加入可用目录。

随后创建账号并保存 API Key，或在 Host 订阅账号上开始 OAuth 登录。OAuth 采用 Driver 指定的回调地址：在供应商页面完成后，将最终浏览器地址粘贴回 Console；Host 核验该次登录的地址、state 和归属。Zhin 不自动启动本地回调监听器。

最后创建 Profile，并将其用于聊天等用途。API Key 与 OAuth token 保存在 Host 私有加密记录中，不出现在 Profile、Session、提示词或普通管理响应中。

个人管理界面首轮支持个人 API Key 连接；个人连接仅允许 HTTPS 公网目标及同源重定向。Host 自己管理的本地 Ollama 等服务不受这条个人连接限制。账号归属由管理员预绑定的真实身份决定，不读取请求正文里的 owner 声明。

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
| `claude-subscription` | OAuth | Claude 订阅 Messages |
| `opencode-go` / `opencode-zen` | API Key | 由服务目录中明确选择的协议决定 |
| `antigravity` | OAuth | Antigravity generateContent |

OpenCode 产品使用其原生 API Key；不把它虚构成 OAuth 订阅。Codex、Claude 和 Antigravity 的协议适配已做合成请求回归；这不代表真实订阅账号、供应商可用性或计费已验收。Antigravity 登录后的只读资料／项目准备可以独立重试，不重放已成功的 token 交换。

Codex 不接受温度和输出 token 上限。它的 Profile 表单不提供这些字段；明确提交不支持的参数会报错，不静默删除。摘要、旁听、审批不再写入隐藏的温度或输出上限，由选中 Profile 统一决定参数。需要供应商硬输出上限的用途应显式选择支持该参数的 Profile。

Antigravity 已有隐式缓存命中的实测证据；本轮不把它宣称为原生显式缓存 CRUD。Google Driver 的显式缓存沿用既有内容指纹与目录机制，配置、账号 incarnation、模型／协议或 Driver 变化会隔离状态，普通 token 刷新不使它换号。

## 独立导入提案

向导单独写入 `ai.plan.yml`，Console 显示预览并由管理员显式导入。启动配置只保存运行策略，不能内嵌 plan；启动、热更和修改提案文件不会自动覆盖数据库里的模型设置。新 Host 可以先启动 Console，再配置模型。

```yaml
# ai.plan.yml — 仅供显式导入
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

这里的能力是管理员对实际部署模型的明确声明，使用前应核实。向导会询问输入类型、工具和流式能力；未知能力保持未知。API Key 的环境引用写作 `auth: { method: api-key, source: env://AI_API_KEY }`，密钥值单独保存在 `.env`，或在 Console 私有密钥表单输入。OAuth 账号写作 `auth: { method: oauth }`，保存账号不代表已登录。

导入文档的字典键是可读别名，不是数据库账号身份。更新已有资源时使用预览提供的明确 bindings；删除后同名新建不继承旧账号、Session 或私人设置。结果未知时保留 mutationId 回查，不换新 ID 重放。

## 用途与 Session

聊天沿用已确认的有限继承：场景 > Endpoint > Adapter > 部署默认；个人 Session 的明确选择优先于这些默认值。每个人在群、私聊、频道分别有独立 Session；群公共事件作为上下文引用。

摘要省略时继承部署聊天，不用个人密钥。旁听拥有独立的部署 `ambient` Language Profile，省略时也继承部署聊天；它与 `decisions.ambient` 的结构化判断是两个合同。识图只尝试明确配置的主项和备用链。只有聊天与识图具有已开放的分层覆盖，不能全量覆盖所有设置。

结构化决策使用 `decision` Profile，按 `skills`、`tools`、`memory`、`agents`、`approval`、`ambient` 分别选择；`off` 不请求，`shadow` 只记录证据，`active` 才交由业务模块决定应用。普通 `evaluate` 只返回真实 Choice／Score／Noul，不虚构概率，也不把合法弃选当失败。

## 插件调用

```ts
import { defineCommand } from '@zhin.js/command';
import { aiInferenceClientToken } from '@zhin.js/ai-provider';

export default defineCommand({
  description: 'List available model profiles',
  async execute(context) {
    const models = context.use(aiInferenceClientToken);
    const profiles = await models.list({ kind: 'language' });
    return profiles.map(profile => profile.label ?? profile.reference.id).join('\n');
  },
});
```

Client 由 Host 绑定到本次真实执行作用域，命令／工具结束时自动关闭。作者不提交 owner、不获取裸 SDK 或 token，也不长期保存 client。`has`／`use` 不提前打开模型请求；流必须完整消费或主动关闭。只需要一条模型结果时使用 `generate`，框架不会替普通调用自动执行模型返回的工具。

Driver 作者只在 `@zhin.js/ai/provider` 增补 `AIProviderRegistry`；Driver 声明自身 Service schema、`profileSchema({ service, model })`、认证、目标、模型合同与执行实现，通过插件注册。Profile 表单、导入、保存和实际请求使用同一模型参数 schema，已知不支持的组合在保存前报错。类型推导不替代运行时身份和权限校验。详见[升级与迁移](./provider-upgrade.md)。


摘要、审批与旁听不再各自覆盖温度和输出上限，由选定 Profile 的显式参数优先决定。通用 SDK 未显式设置输出上限时，沿用既有有效预算：模型目录明确声明的上限，否则 8192；这是执行默认，不会写成 Profile 的显式值。Codex 协议不发送此字段，不代表其他服务也取消了原默认。普通调用者显式请求参数不会被默默吞掉，已知不支持的组合会报错。

`ai` 最低版本为 `^7.0.35`，用于首个内容 chunk 的超时控制。向导从包的 peer 声明生成安装范围；其他所选 SDK 仍按各自声明安装。本轮合成验证使用当前安装版本，未逐一执行整个 semver 范围。
