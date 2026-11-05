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

## 个人 Session 与分层选择顺序

同一个人在具体私聊、群或频道中分别拥有独立 Session。切换模型保留聊天历史；恢复继承移除该 Session 的明确选择。群公共事件通过场景上下文引用，不把所有成员合成一个私人会话。

聊天解析顺序是：**个人 Session 明确选择 > 场景 > Endpoint > Adapter > 部署聊天**。角色任务使用明确的 `agents.<name>` Profile；选择 Host 角色模型不把私人调用者提升成 Host 管理员。

可覆盖范围固定：

| 层级 | 可选择的用途 |
| --- | --- |
| 部署 | 聊天、摘要、旁听语言模型、识图主项与备用链、生图、六类决策、Agent 角色 |
| Adapter／Endpoint | 聊天、识图 |
| 场景 | 聊天 |
| 个人 Session | 聊天 Profile |

摘要省略时继承部署聊天，始终不用个人密钥。旁听 Language Profile 省略时也继承部署聊天，不受个人或场景聊天选择影响；结构化 `decisions.ambient` 单独选择。参数和连接不能作为各层任意覆盖字段。

## 在 Console 中调整

服务、账号、模型 Profile 和部署用途从模型管理页配置。个人页面只显示该 Console 身份由管理员预绑定的真实账号范围，个人首轮使用 API Key 连接；Session 页可以选择可见的聊天 Profile 或恢复继承。

保存是持久化到 Host 数据库，下一回合生效，不修改启动文件或重启进程。在途回合、工具续轮和重试保持开始时固定的配置图与账号。普通 token 刷新不改变配置图；实际请求通过同一账号的当前凭据版本发出。

## 身份与恢复

Session 保存的是 Profile 与账号 incarnation 的不可复用身份，不是标签，也不长期保存短期 revision。修改同一 Profile 的参数或原生模型后，下回合解析它的当前版本，在途仍使用旧模型；模型切换隔离供应商 opaque 状态；删除重建同名账号后，旧 Session 不自动继承新账号。

一个已选 Profile 不存在、越权或不可用时，明确报错，不改用部署聊天。存储读取失败也不当作“没有个人设置”。配置变更结果未知时，保留同一 mutationId 查询 receipt。

独立文件 `ai.plan.yml` 是可读的导入提案；首次启动数据库为空时会自动种子化导入，后续也可在 Console 中预览并显式确认。旧配置和个人 preset 通过[显式迁移](./provider-upgrade.md)映射，原数据保留用于审查和恢复。
