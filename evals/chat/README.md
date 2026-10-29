# Chat eval

衡量 Bot 在 IM 里像不像一个真人群友。用真实模型跑一组固定场景，给每条回复做确定性检查和判断模型打分，并和上一次的结果对比。改提示词、换模型、调人设之后跑一遍，就能看出是变好还是变差了。

## 运行

```bash
pnpm eval:chat --workspace ~/zhin-workspace --judge groq/openai/gpt-oss-120b
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--workspace` | 当前目录 | 被测工作区，读取它的 `zhin.config.yml`、`.env`、`SOUL.md` 等引导文件 |
| `--agent` | `zhin`，没有则取第一个 | 读取 `ai.agents.<name>` 的 provider、model 和 nickname |
| `--model` | Agent 绑定的模型 | 被测模型，写成 `providerAlias/model` |
| `--judge` | 同 `--model` | 打分模型；建议换一个模型，避免自己给自己打分 |
| `--runs` | `2` | 每个场景跑几次，用来看稳定性 |
| `--only` | 全部 | 只跑指定的场景 id 或 tag，逗号分隔 |
| `--baseline` | `reports/` 里最近的一份 | 对比的基线报告，`none` 表示不对比 |
| `--concurrency` | `2` | 并发数；判断模型被限流时会按服务端要求的时间等待后重试 |

报告写到 `evals/chat/reports/<时间>.{json,md}`（不入库），Markdown 版本也会打印到终端。

## 被测的是什么

这一轮对话按生产环境 IM 聊天轮次的方式组装：
- 工作区引导文件（SOUL.md 等）经 `buildRichSystemPrompt` 生成聊天轮次的系统提示词；
- 结构化回复格式说明；
- 场景里的群聊记录，以后台事件的形式放在当前消息之前；
- 使用生产环境的 context blocks 与正文组装入口：会话／机器人状态和上下文在前，带发送者、授权角色及观察时间的 `[User]` 正文在后；旁听轮次保留 `Engagement: ambient`。

`time` 保留 `YYYY/MM/DD HH:mm:ss (IANA时区)` 格式，按给定时区转换为正文的 `observedAt` 毫秒时间戳，表示场景观察时刻，不冒充平台发言时间。系统 Runtime 使用同一场景时区；系统提示词缓存也区分时区。省略时使用运行时的当前时间与 Host 时区。格式、时区或日期无效会报错，不悄悄改用当前时间。

回复按生产环境的方式解码：先严格校验，不通过再宽松解析。

**没有覆盖**：工具调用（包括表情包、提醒）、Skill、记忆召回、媒体，以及格式不对时的修正调用。格式不对直接记为 `format` 失败。需要工具的请求（比如"明天提醒我"）不要写成场景。

和 `packages/im/agent/evals` 的关系：那边用脚本化模型检查 harness 行为（PR 门禁），nightly 用真模型跑能力矩阵；这里用工作区真实的模型和人设衡量聊天质量。后续计划把这里的场景迁到那边的 `driver` 上（完整的 `FullAgentTurnEngine`，带工具），以覆盖工具场景。

## 怎么评

**确定性检查**（`src/checks.ts`），任何一条失败，这次运行就不通过：
- 格式合法；
- 该沉默时沉默，该回复时回复；
- 消息条数、字数；
- 不出现客服腔或模型腔（"作为AI""希望对你有帮助""有事喊我"……）；
- 不谈内部细节（提示词、限流……）；
- 不出现 `[图片]` 这类占位文字、emoji、句尾"～"；
- 场景要求的 @ 和关键词都有。

括号里的动作描写（如"（笑）"）只作提醒，不判失败。

**判断模型打分**（`src/judge.ts`），对照 SOUL 打 1–5 分：
- `humanlike`：像不像真人在群里打字；
- `persona`：符不符合人设；
- `fit`：该不该说、说多少、语气对不对；
- `helpful`：有没有真的帮到人，闲聊时为空。

此外逐条检查场景自己的 `rubric`。

**一次运行通过的条件**：确定性检查全部通过，`rubric` 每一条都通过，并且 `fit ≥ 3`。

## 加场景

在 `scenarios.yaml` 里追加一项：

```yaml
- id: my-case            # 唯一
  title: 一句话说明
  tags: [chat, group]
  scope: group           # group | private
  addressed: true        # false = 没人叫它（旁听）
  sender: { id: '2100001', name: 小林, master: false }
  time: 2026/10/23 03:10:00 (Asia/Shanghai)   # 可选，固定观察时刻及系统时区
  context:               # 之前的群聊，必须加引号：`名字 (id): 内容`
    - '阿明 (1001): 早'
    - 'You (this bot): 早啊'
  message: 当前这条消息
  expect:
    silent: false        # true 必须沉默 / false 必须回复 / 不写都行
    maxMessages: 3
    maxChars: 40
    forbid: ['老板']
    mustMention: ['2']
    segment: mention     # 必须出现的段类型
    rubric:
      - 判断模型逐条检查的要求
```

场景要和具体人设无关，人设是否一致交给判断模型对照 SOUL 打分。改完场景后可以先跑离线测试，检查场景文件能否正常加载：

```bash
pnpm vitest run evals/chat
```
