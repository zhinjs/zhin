---
title: 个人 Session 与用途选择
outline: deep
---

# 个人 Session 与用途选择

Zhin 将大模型的**使用场景（Purpose）**与**底层模型配置（Profile）**解耦：你可以只配一个主力模型跑通所有功能，也可以把高频轻量任务（如旁听判断、上下文压缩、工具挑选）分流给便宜快速的小模型，把复杂对话留给推理模型。

## 核心用途（Purposes）速查

| 用途（Purpose） | 作用 | 未单独配置时的默认行为 | 推荐模型策略 |
| --- | --- | --- | --- |
| `chat` | 主对话与工具调用推理 | **必填**（部署默认聊天 Profile） | 主力对话/推理模型（如 `deepseek-chat`、`gpt-4o`、`claude-sonnet-4-20250514`、`qwen-plus`） |
| `compaction`（`summary`） | 长对话历史自动摘要压缩 | 继承部署 `chat` Profile | 便宜、长窗口的快模型（如 `gpt-4o-mini`、`qwen-turbo`） |
| `ambient` | 群聊旁听判断（决定没人 @ 时要不要接话） | 继承部署 `chat` Profile | 低延迟、低成本小模型 |
| `perception` / `vision` | 为纯文本主模型描述图片（多模态感知及备用链） | 仅在显式配置时启用 | 视觉模型（如 `gpt-4o-mini`、`qwen-vl-plus`、`gemini-2.5-flash`） |
| `selection`（`decisions.*`） | 结构化决策（`skills` / `tools` / `memory` / `agents` / `approval` / `ambient`） | 默认关闭（`off`） | 轻量决策模型（配合 `@zhin.js/service-typesafe`） |

### 示例：一套 Profile 通吃 vs 快慢模型分流

```yaml
# ai.plan.yml
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
  main:
    service: deepseek
    auth:
      method: api-key
      source: env://DEEPSEEK_API_KEY
profiles:
  main-chat:
    account: main
    model: deepseek-chat
  fast-aux:
    account: main
    model: deepseek-chat
    parameters:
      maxOutputTokens: 1024
purposes:
  chat:
    profile: main-chat        # 主对话用主力配置
  compaction:
    profile: fast-aux         # 可选：摘要压缩与旁听用轻量配置（省略时自动复用 chat）
  ambient:
    profile: fast-aux
```

## 备用模型（fallbacks）

每个语言用途都可以配置按顺序尝试的备用模型：`chat`、`summary`、`ambient`、`agents.<name>`、`adapters|endpoints.<key>.chat`、`scenes.<key>.chat`，以及原有的 `perception`。写法是 Profile 名字符串，或 `{ profile, fallbacks }`：

```yaml
purposes:
  chat:
    profile: gemini-free          # 主模型
    fallbacks: [cnb, deepseek]    # 依次尝试
  summary: { profile: gemini-free, fallbacks: [deepseek] }
  agents:
    researcher: { profile: gemini-free, fallbacks: [deepseek] }
  adapters:
    qq:
      chat: { profile: gemini-free, fallbacks: [cnb] }
  scenes:
    "github:...":
      chat: { profile: cnb, fallbacks: [deepseek] }
```

- **何时切换**：只有主模型以「额度用完」（如 Gemini 免费档日配额）、「余额不足」或「鉴权失败」失败时，才换下一个备用模型继续回答。超时、服务端 5xx、限流和网络错误仍按原来的同模型重试处理，不切换。
- **不重复执行工具**：切换发生在单次模型请求上，从当前对话继续；本回合已经执行过的工具不会再执行。已经向用户输出了部分文字时不切换。
- **暂时跳过**：额度用完的模型在恢复前直接跳过——有供应商给出的重置时间就按它；Gemini 等日配额默认到美国太平洋时间午夜；其他配额与余额不足 1 小时，鉴权失败 15 分钟。跳过状态只在内存中，重启后会再试一次。
- **每层各管各的链**：场景 / Adapter 覆盖了聊天模型，就只用该层写的备用链；摘要、旁听没单独配置时沿用部署聊天及其备用链。生图和六类决策不支持备用链；个人 Session 自选的聊天模型也不带备用链。
- **能看到**：用了备用模型的回合在 `zhin trace` 中标记「本轮由备用模型回答」（`model_fallbacks`）；Console 用途页可读取当前被跳过的模型和最近的切换记录。

备用 Profile 与主项一样必须是部署（Host）所有的 Profile。设计细节见 [ADR 0047 增补](../adr/0047-ai-provider-subscriptions-and-decision-models.md#增补用途备用模型1250-chat-purpose-no-fallback2026-11)。

## 个人 Session 与分层选择顺序

同一个人在具体私聊、群或频道中分别拥有独立 Session。切换模型保留聊天历史；恢复继承移除该 Session 的明确选择。群公共事件通过场景上下文引用，不把所有成员合成一个私人会话。

聊天解析顺序是：**个人 Session 明确选择 > 场景 > Endpoint > Adapter > 部署聊天**。角色任务使用明确的 `agents.<name>` Profile；选择 Host 角色模型不把私人调用者提升成 Host 管理员。

可覆盖范围固定：

| 层级 | 可选择的用途 |
| --- | --- |
| 部署 | 聊天、摘要、旁听语言模型、识图（均可带备用链）、生图、六类决策、Agent 角色（可带备用链） |
| Adapter／Endpoint | 聊天、识图（均可带备用链） |
| 场景 | 聊天（可带备用链） |
| 个人 Session | 聊天 Profile |

摘要省略时继承部署聊天，始终不用个人密钥。旁听 Language Profile 省略时也继承部署聊天，不受个人或场景聊天选择影响；结构化 `decisions.ambient` 单独选择。参数和连接不能作为各层任意覆盖字段。

## 在 Console 中调整

服务、账号、模型 Profile 和部署用途从模型管理页配置。个人页面只显示该 Console 身份由管理员预绑定的真实账号范围，个人首轮使用 API Key 连接；Session 页可以选择可见的聊天 Profile 或恢复继承。

保存是持久化到 Host 数据库，下一回合生效，不修改启动文件或重启进程。在途回合、工具续轮和重试保持开始时固定的配置图与账号。普通 token 刷新不改变配置图；实际请求通过同一账号的当前凭据版本发出。

## 身份与恢复

Session 保存的是 Profile 与账号 incarnation 的不可复用身份，不是标签，也不长期保存短期 revision。修改同一 Profile 的参数或原生模型后，下回合解析它的当前版本，在途仍使用旧模型；模型切换隔离供应商 opaque 状态；删除重建同名账号后，旧 Session 不自动继承新账号。

一个已选 Profile 不存在、越权或不可用时，明确报错，不改用部署聊天。存储读取失败也不当作“没有个人设置”。配置变更结果未知时，保留同一 mutationId 查询 receipt。

独立文件 `ai.plan.yml` 是可读的导入提案；首次启动数据库为空时会自动种子化导入，后续也可在 Console 中预览并显式确认。旧配置和个人 preset 通过[显式迁移](./provider-upgrade.md)映射，原数据保留用于审查和恢复。
