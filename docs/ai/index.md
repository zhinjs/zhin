---
title: "AI 能力总览"
description: "给 Bot 接入大模型：三步启用、AI 什么时候会回复、如何让它调用工具，以及模型、触发规则、访问控制、MCP 与执行安全的配置"
---

# AI 能力总览

默认安装的 Zhin 只会执行命令，不会"聊天"。启用 AI 后，**没有匹配到任何命令的消息**会交给大模型回答，模型还可以调用你写的工具。

AI 是可选的：不启用时，Bot 不依赖任何模型 SDK，也不需要 API Key。

## 三步启用

**1. 运行向导**

```bash
npx zhin setup --ai
pnpm install
```

向导会让你选择模型服务（OpenAI、Anthropic、DeepSeek、Google、OpenAI 兼容接口，或本地的 Ollama），然后安装对应 SDK 和 Agent 运行时，并在 `package.json` 里声明工具与 Prompt Section 能力。

**2. 填写密钥**

云端模型的 Key 写在 `.env` 里（向导会提示变量名，例如 `AI_API_KEY`）。使用本地 Ollama 时不需要 Key。

**3. 试一试**

```bash
pnpm dev
```

在 Sandbox 私聊里直接发一句话，或者在群聊里发 `ai: 你好`，Bot 会用模型回复。

向导写入 `zhin.config.yml` 的配置大致如下：

```yaml
ai:
  enabled: true
  providers:
    openai-main:          # 自己起的名字
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:                 # 主 Agent，必须叫 zhin
      provider: openai-main
      model: gpt-4o-mini
```

`providers` 定义"连哪个模型服务"，`agents` 定义"哪个 Agent 用哪个模型"。

::: details 不用向导，手动安装
```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 按所用厂商安装对应的 SDK
```

只装 `@zhin.js/agent` 不足以让 `tools/`、`prompt-sections/` 目录生效，还需要在 `package.json#zhin.features` 中声明 `@zhin.js/tool` 与 `@zhin.js/prompt-section`。代码里从 `zhin.js/agent`（或 `@zhin.js/agent`）导入 `ZhinAgent`、`AIService` 等。模型 SDK 是可选依赖，缺失时启动会报 `Missing peer dependency` 并给出安装命令。
:::

## AI 什么时候会回复

没有匹配到命令的消息，按下面的顺序判断是否交给 AI：

| 顺序 | 情况 | 默认行为 |
| --- | --- | --- |
| 1 | 消息以 `/`、`!`、`！` 开头 | 跳过 AI，避免和命令冲突 |
| 2 | 消息以 `#`、`AI:`、`ai:` 开头 | 交给 AI（私聊和群聊都生效），去掉前缀后作为问题 |
| 3 | 群聊或频道中 @ 了 Bot | 交给 AI |
| 4 | 私聊 | 整条消息直接交给 AI |
| 5 | 私聊中包含设置的关键词 | 交给 AI |

所以在群里，Bot 默认**不会**插话，只有被 @ 或使用前缀时才回复。这些规则都可以修改，见 [ai.trigger](#ai-trigger)。

## 让 AI 做事

AI 默认只能聊天。要让它查天气、搜歌、操作数据库，写一个工具放进 `tools/`：

```ts
// tools/weather/index.ts
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ city: string }>({
  description: '查询城市的实时天气',
  inputSchema: z.object({ city: z.string().min(1) }),
  async execute({ city }) {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    return response.text();
  },
});
```

工具参数的 schema 会原样发给模型，`enum`、`anyOf`、可空类型、`integer`、`format` 和取值范围都会保留，MCP 工具也一样。模型传回的参数按同样的约束校验，不符合时会把错误告诉模型，让它重新调用。Gemini 不接受没有类型的字段，这类字段发给 Gemini 时会按字符串处理。

限制工具的使用范围、要求用户确认、用 Skill 封装流程、补充业务背景，见 [Agent 工具与技能](../authoring/agent-tools.md)。

## 常见调整

| 我想…… | 改这里 |
| --- | --- |
| 换模型或厂商、接入本地模型 | [ai.providers](#ai-providers) |
| 让群里不 @ 也能触发，或修改前缀 | [ai.trigger](#ai-trigger) |
| 只对部分用户或群开放 AI | [ai.access](#ai-access) |
| 不同的群用不同的 Agent 或模型 | [ai.agents](#ai-agents) |
| 让 AI 使用外部 MCP 服务器的工具 | [ai.mcpServers](#ai-mcpservers) |
| 控制 AI 能执行哪些 Shell 命令、是否需要审批 | [ai.agent](#ai-agent) |
| 让 AI 理解语音、回复语音 | [语音](./speech.md) |

## 配置参考

全部配置位于 `zhin.config.yml` 的 `ai:` 段，`${VAR}` 会从环境变量展开。

### ai.providers

每个 provider 以你起的名字为键，`sdk` 决定使用哪个模型 SDK：

```yaml
ai:
  providers:
    openrouter:
      sdk: openai-compatible
      baseUrl: ${OPENROUTER_BASE_URL}
      apiKey: ${OPENROUTER_API_KEY}
```

| sdk | 需要安装 | 关键配置 |
|-----|-----------|----------|
| `openai` | `@ai-sdk/openai` | `apiKey`，可选 `baseUrl`（代理根路径自动补 `/v1`，规则同 `openai-compatible`） |
| `openai-compatible` | `@ai-sdk/openai-compatible` | `baseUrl` + `apiKey`（路径里没有版本号时自动补 `/v1`，见下方 `compat`）；Cloudflare Workers AI 可用 `accountId` 代替 `baseUrl` |
| `anthropic` | `@ai-sdk/anthropic` | `apiKey`，可选 `baseUrl`（自动补 `/v1`） |
| `deepseek` | `@ai-sdk/deepseek` | `apiKey`，可选 `baseUrl` |
| `minimax` | `@ai-sdk/minimax` | `apiKey`，可选 `baseUrl`（默认 `https://api.minimax.io/anthropic/v1`；国内站写 `https://api.minimaxi.com/anthropic`，自动补 `/v1`） |
| `google` | `@ai-sdk/google` | `apiKey`，可选 `baseUrl`（自动补 `/v1beta`） |
| `ollama` | `@ai-sdk/openai-compatible`（通过 OpenAI 兼容接口） | `host`（默认 `http://127.0.0.1:11434`，自动补 `/v1`），不需要 `apiKey`；建议写 `contextWindow`（见下方） |

可选字段：

- `models`：允许使用的模型列表。不写时，启动后会自动从 `/v1/models` 获取（先用上次的缓存，再在后台刷新）。
- `input`：模型能接收的内容类型，`text | image | audio | video | file`。不写时按 SDK 和模型名取默认值：
  - `sdk: google` 的 Gemini 对话模型原生多模态，默认 `text, image, audio, video, file`；TTS、embedding、图像生成和 Live 模型只按文本处理。
  - `sdk: openai` 的 GPT-4o、GPT-4.1、GPT-4.5、GPT-5.x 以及 o1、o3、o4-mini，和 `sdk: anthropic` 的 Claude 3 及以后的模型，默认 `text, image`。audio、realtime、TTS、search、embedding、图像生成这些变体，以及 o1-mini、o3-mini，只按文本处理。PDF 等文件不默认开启，需要时写 `input: [text, image, file]`。
  - 其他 SDK（DeepSeek、MiniMax、Ollama、各类网关）只按文本处理，因为同一家的模型能力不一样。Groq 例外：Llama 4 Scout / Maverick 默认 `text, image`，GPT-OSS 等其他模型只按文本处理。

  写了 `input` 就以它为准。
- `contextWindow`：上下文窗口大小。不写时一般按 128k 估算；`sdk: ollama` 例外：先读 `OLLAMA_CONTEXT_LENGTH` 环境变量（zhin 和 Ollama 在同一台机器时有效），否则按 4096 计算。Ollama 按显存分配上下文（24 GiB 以下 4k，24–48 GiB 32k，48 GiB 以上 256k），OpenAI 兼容接口无法逐请求调大，超出部分会被**静默截掉开头**（包括 system prompt），所以框架宁可少估。请把 `contextWindow` 写成 `ollama ps` 里 CONTEXT 列的值；没写时启动会给出提示。
- `thinkingLevel`：思考深度，`off | low | medium | high`。不写时用 provider 默认。框架把它作为 AI SDK 的 `reasoning` 参数传给各 SDK，再由 SDK 换成自己的设置：Gemini 3 的 `thinkingLevel`（`off` 对应 `minimal`）、Gemini 2.5 的思考预算、Claude 的 thinking 预算、OpenAI 和 DeepSeek 的 reasoning effort。如果 `providerOptions` 里已经写了思考设置（`thinkingConfig`、`thinking`、`reasoningEffort` 或 `effort`），以 `providerOptions` 为准。MiniMax 固定用自适应思考，不受影响。
- `maxOutputTokens`：每次请求的输出 token 上限，默认 `8192`。Gemini 和 Claude 的思考 token 也算在里面，所以 `thinkingLevel: high` 时建议调大，免得回复被截断。
- `compat`（`openai-compatible` / `ollama`）：
  - `includeUsage`：是否请求流式 usage（`stream_options.include_usage`），默认 `true`。不写的话大多数兼容服务流式时不返回 token 用量；少数拒绝该字段的服务设为 `false`。
  - `appendV1`：`baseUrl` 是否补 `/v1`。不写时：路径里已有版本段（如 `/api/v3`、`/api/paas/v4`、`/v1beta/openai`）或以 `/openai` 结尾就原样使用，否则补 `/v1`（旧配置 `https://host`、`https://host/api` 行为不变）。`true` 总是补（旧行为），`false` 总是原样。
  - `promptCacheKey`：是否发送 OpenAI 的 `prompt_cache_key`，默认 `false`（严格的网关会拒绝未知字段）。
  - `supportsDeveloperRole`（`sdk: openai`）：设为 `false` 时推理模型（o 系列、gpt-5）的系统提示用 `system` 角色发送，给不认 `developer` 的 OpenAI 协议端点用。
  - `supportsReasoningContent`、`toolCallsInAssistant` 已废弃，不起作用。
- `authScheme`：`Authorization` 头方案。不写时用 SDK 默认（OpenAI 系 `Bearer`，Anthropic `x-api-key`，Google `x-goog-api-key`）；`''` 发送 `Authorization: <key>`；`Bearer`、`Token` 等发送 `Authorization: <scheme> <key>`。对话请求和模型列表请求用同一规则。
- `timeout`、`maxRetries`：该 provider 的单次请求超时（毫秒，0 关闭）和每个模型的重试次数，覆盖 `ai.providerResilience` 的 `requestTimeoutMs` / `maxRetries`；按模型配置的 `modelHarness.requestTimeoutMs` 仍然优先。
- `firstChunkTimeoutMs`、`chunkTimeoutMs`：流式卡顿超时（毫秒），默认关闭。前者限制等响应头和第一个 chunk 的时间，后者限制两个 chunk 之间的静默时间。超时按 timeout 处理：重试，用尽后切换备用模型。比 `timeout` 更早发现“连上了但不出字”的请求，建议设成几十秒。
- `imageGeneration`：文生图的默认参数。
- `providerOptions`：按 SDK 名分组的 AI SDK `providerOptions`，每次请求都会合并进去。Gemini 常用的是安全设置和思考深度：

  ```yaml
  ai:
    providers:
      gemini:
        sdk: google
        apiKey: ${GEMINI_API_KEY}
        defaultModel: gemini-3.8-flash
        providerOptions:
          google:
            safetySettings:
              - { category: HARM_CATEGORY_HARASSMENT, threshold: BLOCK_ONLY_HIGH }
            thinkingConfig: { thinkingLevel: low }
  ```

  Gemini 因安全策略（SAFETY、PROHIBITED_CONTENT、RECITATION、提示词被拦截等）拒答时，用户会看到一句礼貌的说明（“抱歉，这条内容触发了模型的内容安全策略，没能生成回复（SAFETY），换个说法再试试吧”），而不是一条空回复。这种拒答不会重试，也不会切换到备用模型：同样的内容再问一次结果相同，换模型绕过拒答等于绕过你配置的 `safetySettings`。Gemini 走隐式缓存：system prompt 和工具定义保持不变，命中的 token 记在 usage 的 `cacheRead` 和 turn trace 的 `cache_read_tokens` 里。如果想要更稳定的折扣，可以开显式缓存：`contextCache: { mode: explicit, ttlSeconds: 600 }`。开启后，框架会给 system prompt 和工具定义建一个 `cachedContents`，在 TTL 内复用；前缀变了就新建一个并删掉旧的，服务端缓存失效时自动退回完整请求，建不了（比如前缀太短）时退回隐式缓存。缓存按存储时长计费。显式缓存只支持 Gemini 3 / 2.5，Gemini 4 Argon 及以后不支持。

- **Gemini 走自己的代理**：如果代理只是原样转发（请求、`x-goog-api-key` 鉴权和响应都和官方一致，只是域名不同），把 `baseUrl` 指到代理即可。写到根路径或带 `/v1beta` 都行，结尾的 `/` 会被去掉，不会出现重复的 `/v1beta`。不写时默认 `https://generativelanguage.googleapis.com`。`generateContent`、流式的 `streamGenerateContent`、显式缓存的 `cachedContents`（创建和删除）以及模型列表都会走这个地址。代理需要额外请求头时可以加 `headers`，所有请求都会带上，可不填：

  ```yaml
  ai:
    providers:
      gemini:
        sdk: google
        apiKey: ${GEMINI_API_KEY}
        baseUrl: https://gemini-proxy.example.com   # 等价于 https://gemini-proxy.example.com/v1beta
        headers:                                   # 可选
          x-proxy-tag: zhin
  ```

- **Groq（GroqCloud）**：走 `openai-compatible`，框架内置了 Groq 预设。别名写 `groq`（或 `groqcloud`）时可以省略 `sdk` 和 `baseUrl`；`baseUrl` 指向 `api.groq.com` 时，无论别名是什么都按 Groq 处理，`sdk: openai` 也会被改成 `openai-compatible`：

  ```yaml
  ai:
    providers:
      groq:
        sdk: openai-compatible
        baseUrl: https://api.groq.com/openai/v1
        apiKey: ${GROQ_API_KEY}
        models:
          - openai/gpt-oss-120b
          - openai/gpt-oss-20b
        # thinkingLevel: medium   # GPT-OSS 默认 low，可改 medium / high
  ```

  注意事项：
  - 之前的思考内容按 Groq 接受的 `reasoning` 字段回传（Groq 拒绝 SDK 默认的 `reasoning_content`，否则工具循环的第二步会 400）。
  - Groq 不支持 `logprobs`、`top_logprobs`、`logit_bias` 和大于 1 的 `n`，这些字段不会发出去。
  - `reasoning_effort` 只发给 GPT-OSS 和 Qwen 3；GPT-OSS 默认 `low`，回复快，也更不容易碰到免费档每分钟 8K token 的上限。其他模型（如 Llama）即使配置了 `thinkingLevel` 也不会带这个字段。
  - GPT-OSS 只收文本，图片会按"模型不支持图片"处理，不会发给 Groq；Llama 4 Scout / Maverick 默认 `text, image`。写了 `input` 以它为准。
  - 上下文窗口按模型名推断：GPT-OSS 是 131072，其他模型按 128k 估算，可用 `contextWindow` 覆盖。
  - 免费档限额很低（GPT-OSS 约每分钟 8K token、每天 1000 次请求，见 [Groq 限额](https://console.groq.com/docs/rate-limits)）。每分钟的限额（RPM / TPM）触发 429 时按 `retry-after` 等待后重试；每天的限额（RPD / TPD）当天重试没用，直接切换到下一个候选模型（限额按模型计算），没有候选时提示今天的额度已用完。

### ai.agents

把 Agent 名字绑定到 `provider + model`。`zhin` 是主 Agent，必须存在：

```yaml
ai:
  agents:
    zhin:
      provider: openrouter
      model: openrouter/free
      mcpServers: [icqq]        # 这个 Agent 使用的 MCP 服务器
      nickname: 小智            # AI 的自称和界面展示名
    planner:
      provider: openrouter
      model: openrouter/free
      permission:               # 它能派出哪些子 Agent
        task: { "researcher": allow, "*": deny }
```

| 字段 | 说明 |
|------|------|
| `provider` / `model` | 引用 `ai.providers` 的名字与模型 id（必填） |
| `mcpServers` | 引用 `ai.mcpServers` 中的 `name` |
| `nickname` | AI 的自称与展示名 |
| `permission.task` | glob → `allow` / `deny`，限制 `spawn_task` 能派出的子 Agent |

IM 消息总是交给 `zhin`；其他 Agent 只按名字调用（`spawn_task`、协作角色）。

::: warning 已弃用：`priority` / `match`
`ai.agents.<name>.priority` 和 `match`（包括 `hasMedia`、`scene`、`adapter` 等全部条件）从来没有生效过。现在仍然接受，但启动时会告警，`zhin config check --fix` 会删除它们，下一个 minor 版本移除。想让文本模型看懂图片，请用 [`ai.multimodal.perception`](#ai-multimodal-perception)。
:::

### ai.mcpServers

让 AI 连接**外部的 MCP 服务器**，使用对方提供的工具。需要安装 `@modelcontextprotocol/sdk`。

```yaml
ai:
  mcpServers:
    - name: icqq
      transport: streamable-http      # stdio | streamable-http | sse
      url: ${ICQQ_MCP_URL}
      headers:
        Authorization: Bearer ${ICQQ_MCP_TOKEN}
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/zhin-mcp-test"]
```

- 连接成功后，对方的工具以带服务器名前缀的名字加入工具池。
- **任何一个服务器连接失败，新配置都不会生效**，旧版本继续服务。
- `ai.agents.<name>.mcpServers` 只能引用这里声明过的名字，否则配置校验失败。

::: tip 反过来：把你的 Bot 变成 MCP 服务器
如果想让外部 AI 客户端连接你的 Bot，使用顶层的 `mcp:` 配置，并运行 `pnpm add @zhin.js/mcp @zhin.js/agent zod ai`。这与 `ai.mcpServers` 是两回事，设置其中一个不会开启另一个。见 [MCP Server 配置](https://github.com/zhinjs/zhin/blob/main/packages/host/mcp/README.md)。
:::

### ai.trigger

```yaml
ai:
  trigger:
    prefixes: ["ai:"]          # 默认 ['#', 'AI:', 'ai:']
    ignorePrefixes: ["/"]      # 默认 ['/', '!', '！']
    respondToAt: true          # 默认 true：群里 @ Bot 时触发
    respondToPrivate: true     # 默认 true：私聊直接触发
    keywords: []               # 私聊中包含这些词时触发
    timeout: 60000             # 单轮超时（毫秒）
    thinkingMessage: 思考中…    # 可选：开始处理前的占位回复
    # errorTemplate: "出错了：{error}"   # 可选；不配置时用聊天口吻说"刚卡了一下"，主人会额外看到原因
    masters: ["10001"]         # 有审批权的用户
    trusted: []                # 受信任用户（权限低于 master）
```

@ 触发依赖适配器标记消息为"提到了 Bot"（例如 CQ 码、Slack 的 app_mention）。

出错时，Bot 在聊天里像群友一样说"刚卡了一下，你再说一遍？"，不提模型、密钥、重试这些内部细节；发送者是主人（master）时，会在括号里附上简短原因，例如"（模型额度用完了）"。完整错误只写日志。HTTP、Console 等非聊天入口保留原来的精确提示。配置了 `errorTemplate` 时，入口层的报错按模板发送。

被 @、引用和私聊的消息总会交给 Agent，Agent 也可以判断不需要回复，返回空消息（`{"messages":[]}`）后什么都不发。

#### 群聊旁听（ambient）

群里没人叫 Bot 时，可以让它自己决定要不要接话：

```yaml
ai:
  trigger:
    ambient:
      conversations: ["icqq:1048877509"]  # platform:groupId；"*" 表示所有群
      judge:                              # 判断模型，默认用主 Agent 的模型；建议用便宜、快的模型
        - groq/openai/gpt-oss-120b        # 可写成列表：前一个失败或限流时按顺序换下一个
        - groq/openai/gpt-oss-20b
      quietMs: 4000                       # 群安静这么久之后，对这一串消息判断一次
      cooldownMs: 120000                  # 两次主动插话之间的最短间隔
      maxPerHour: 3                       # 每个群每小时最多主动插话次数
      conversationWindowMs: 180000        # Bot 说话后这段时间内算作对话进行中
      judgeIntervalMs: 30000              # 没在对话时，同一个群至少隔这么久才判断一次
      minConfidence: 0.7                  # 判断模型的置信度门槛
      mode: active                        # shadow：只记录判断结果，不回复
```

流程：
1. 群里有新消息后等群安静 `quietMs`，期间的新消息合并为一次判断。
2. 判断模型读最近 20 条消息（Bot 自己的话标为 `You (this bot)`），给出要不要接话和置信度。
   - **对话进行中**（Bot 在 `conversationWindowMs` 内说过话，无论是被 @ 还是主动接话）：群友接它的话只看判断结果，不受冷却和每小时次数限制，只有每小时 30 次的安全上限。
   - **没有对话时**：主动插话受 `cooldownMs` 和 `maxPerHour` 限制。
3. 达到门槛后交给主 Agent 正常处理。这一轮的上下文会注明"没人叫你"，Agent 仍然可以选择不说话。

每次判断都会记一条 `ambient_engagement` 日志（结果、置信度、理由）。建议先用 `shadow` 跑一段时间，看判断是否靠谱，再改成 `active`。

### ai.access

控制哪些会话可以使用 AI（例如为满足平台对 AIGC 的合规要求）：

```yaml
ai:
  access:
    mode: whitelist     # open（默认）| closed | whitelist
    users: ["10001"]    # 允许的用户 id
    groups: ["123456"]  # 允许的群 / 频道 id
    denyMessage: 当前会话未开放 AI 功能。
```

私聊被拒绝时回复 `denyMessage`；群聊和频道被拒绝时不回复。

### ai.multimodal.perception

主模型不能看图（例如 Groq 的 `gpt-oss` 只收文本）时，图片默认只会变成 `[Media unsupported:provider_input: image]` 占位，AI 不知道图里是什么。配置 `perception` 后，框架先用一个能看图的模型（例如 Gemini Flash-Lite）把图片描述成文字，再交给主模型：

```yaml
ai:
  providers:
    groq:
      sdk: openai-compatible
      baseUrl: https://api.groq.com/openai/v1
      apiKey: ${GROQ_API_KEY}
    gemini:
      sdk: google
      apiKey: ${GEMINI_API_KEY}
  agents:
    zhin:
      provider: groq
      model: openai/gpt-oss-120b
  multimodal:
    perception:
      provider: gemini              # 必填，ai.providers 里的名字
      model: gemini-2.5-flash-lite  # 必填，这个模型必须声明能接收对应类型
      # 可选：预先在 ai.providers 中配置备用 provider，并声明模型的 image 输入能力
      # fallbacks:
      #   - { provider: backup, model: your-vision-model }
      kinds: [image]                # 可选：image | video | file，默认 [image]；file 只处理 PDF
      maxChars: 800                 # 可选：描述最长字符数，默认 800
      timeoutMs: 30000              # 可选：单次请求超时，默认 30000
      maxItemsPerTurn: 4            # 可选：每个回合最多描述几项，默认 4
```

| 字段 | 说明 |
| --- | --- |
| `provider` / `model` | 用来描述媒体的模型，`provider` 必须是 `ai.providers` 里的名字；配置错误时启动失败，`zhin config check` 也会报错 |
| `fallbacks` | 可选的 `{ provider, model }` 列表，主模型无法生成描述时按顺序尝试；不配置则保持单模型行为 |
| `kinds` | 要描述的类型。音频不在这里，仍走 `ai.multimodal.audio` 的语音转写 |
| `maxChars` | 描述超出时截断 |
| `timeoutMs` | 单次请求超时；失败最多重试 1 次，走和主对话相同的重试、超时和错误分类 |
| `maxItemsPerTurn` | 一个回合里超出数量的媒体保持占位 |

行为说明：

- 只处理主模型收不了的媒体。主模型本身能看图时，图片照常直接发给主模型，不会调用 `perception`。
- 描述以 `[图片描述]` / `[视频描述]` / `[文件描述]` 开头，并标注为**不可信的外部内容**：图片里的文字可能夹带指令，模型只把它当作数据。读过描述的回合属于“已接触外部内容”，之后执行命令、给其他会话发消息、改配置、建定时任务都需要审批，审批卡片的来源链会写“图片/媒体的自动描述”。
- 描述会随用户消息写入会话历史，之后的回合可以继续问“刚才那张图”；图片本身不写入历史。
- 相同内容的图片（按字节的 sha256）只描述一次，常见的表情包和贴纸不会重复调用。
- 描述失败、超时或超出 `maxItemsPerTurn` 时，回到原来的占位，回合照常进行。每项媒体的结果记录在 `zhin trace` 时间线的 `media_resolution` 事件里，描述成功时 `code` 为 `media_perception` 并带上所用模型。
- `fallbacks` 按顺序切换：请求失败、空回答或模型不支持媒体类型都会尝试下一项；每个候选适用 `timeoutMs` 和至多一次重试。取消回合立即停止，不切换。所有候选失败才保留占位，不猜测图片内容。
- 缓存与 trace 记录实际成功的 provider/model；费用统计累计失败候选和最终候选。备用列表越长，最坏等待时间越长，应使用少量已验证的模型。
- ICQQ 的普通动画表情按 image 处理；原创 bface 表情转换为图片链接并保留文字标签。失效链接仍可能无法识别。
- 不配置 `perception` 时行为与之前完全一样。

### ai.agent

`ai.agent` 控制 AI 的运行方式，其中最重要的是 `bash` 等执行类工具的安全策略：

```yaml
ai:
  agent:
    execSecurity: allowlist       # deny | allowlist（默认）| full
    execPreset: readonly          # readonly | network | development | custom
    execAllowlist: [make]         # execPreset=custom 时的白名单
    execApprovalMode: ask         # ask（默认）| bypass | auto
    gitStatus: true               # 默认 true：在提示词中注入一行 git 状态（非 git 仓库自动跳过）
    contextPaths: []              # 额外注入系统提示词的上下文文件（支持 ~ 与相对路径）
    systemPromptMaxChars: 100000  # 系统提示词总字符上限
    inboundQueue:
      groupMode: supersede        # 默认：同一发起人的新消息替换他尚未回复的回合；fifo：全部按到达顺序排队
      maxQueuedTurns: 5           # 每个会话最多排队的回合数
      ttlMs: 180000               # 排队超时
```

**命令白名单**：`execPreset` 逐级放宽——`readonly`（ls、cat、grep、find 等）→ `network`（再加 curl、wget、ping 等）→ `development`（再加 npm、node、git、python 等）。无论哪种模式，`sudo`、`eval`、`dd`、`export` 等危险命令一律拒绝，`rm -rf node_modules` 这类操作直接阻断。

**审批方式**：

| `execApprovalMode` | 行为 |
| --- | --- |
| `ask`（默认） | 向 master 请求审批 |
| `auto` | 交给一个没有工具的审核 Agent 判断；它无法判断时再询问 master；模型出错、超时或输出无效时直接拒绝 |
| `bypass` | 跳过审批，但仍然不能绕过危险命令黑名单、工具权限、文件 / 网络边界和沙箱 |

审批时，群聊和频道里可以选择"拒绝 / 仅本次 / 当前会话 / 始终允许"，私聊里是"拒绝 / 仅本次 / 始终允许"。"当前会话"对会话中所有人生效；"始终允许"只对当前发送者生效；所有持续决定都只绑定当前会话。`/approve always bash` 与 `/approve rule <正则>` 管理本账号的持久放行规则。

::: details 更多细节
- **全局上下文文件**：除 `contextPaths` 外，还会自动加载 `~/.config/zhin/AGENTS.md` 与 `~/.config/zhin/ZHIN.md`（不存在则跳过），作为 `# User Context` 段放在项目上下文之前；单个文件最多 8KB，总计最多 16KB。
- **提示词预算**：超过 `systemPromptMaxChars` 时，先移除 `opportunistic` 的内容；`required` 的内容放不下时，本轮明确失败。
- **命令检查链**：危险黑名单 → 去掉环境变量前缀（`FOO=bar cmd` 按 `cmd` 匹配）→ 去掉 wrapper（`timeout 10 cmd`）→ 拆分复合命令（`&&`、`|` 逐段检查）→ 非 `full` 模式下拒绝换行、`$(...)` 和反引号 → 只读命令自动放行。审批通过当前回合的 `ApprovalPort` 发起。
- **旧版审批文件**：V1 审批文件不会在线迁移，升级前需要显式重建规则。
- **消息排队**：`inboundQueue.groupMode` 也是默认的回合意图策略。`supersede` 表示同一发起人的新消息会替换他自己尚未回复的回合（其他成员的消息总是排队，不会打断别人）；`fifo` 表示按到达顺序等待。详见 [Agent：回合运行中又来了消息](./agent.md)。`steer`、`follow_up`、`observe` 由适配器、命令或其他策略显式指定；跨参与者的 `steer` / `follow_up` 授权只能由 Host 的可信 `resolveTurnIntent` 策略产生，消息 metadata 不能自行声明。工具始终受当前回合的权限约束，执行日志会记录发起控制的用户与回合 ID。
:::

## 它是怎么工作的

```mermaid
flowchart LR
    M[收到消息] --> C{匹配到命令?}
    C -- 是 --> R1[执行命令]
    C -- 否 --> T{符合 ai.trigger?}
    T -- 否 --> X[不回复]
    T -- 是 --> G{ai.access 允许?}
    G -- 否 --> X
    G -- 是 --> A[Agent 回合]
    P[ai.providers] --> A
    S[工具 / MCP] --> A
    A --> R2[回复]
```

启动时，Zhin 会自动清理 `ai:` 配置：凭据展开后为空的 provider 会被剔除（只记录 debug 日志），绑定到它的 Agent 一并跳过；如果最终没有可用的 `zhin` Agent，AI 不会启用，但**不影响** Bot 的其他功能正常启动。

## 下一步

- [Agent 工具与技能](../authoring/agent-tools.md)：让 AI 调用你的函数。
- [Agent 深入](./agent.md)：回合、按需加载工具、子任务、会话与上下文压缩。
- [结构化决策](./structured-decisions.md)：Agent / Skill / Tool 推荐、检索排序与自动审核。
- [语音](./speech.md)：语音识别与语音回复。
- [Console](../console/index.md)：在浏览器里观察 AI 会话与运行情况。
