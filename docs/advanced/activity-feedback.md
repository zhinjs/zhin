# Activity Feedback

`@zhin.js/service-activity-feedback` 把 Agent 执行状态投影到原始 IM 会话，让用户在等待时知道系统仍在工作。

## 覆盖的状态

- 主 Agent：排队、处理中、thinking、完成或失败时清理。
- 工具与 Task 迭代：更新当前状态消息，例如“处理中 [2/15]…”、“调用工具：web_search…”。
- 子 Agent：按 `agentId + taskId` 使用独立状态，不覆盖主 Agent；结束时自动清理。
- Schedule：显示开始状态，并短暂展示完成或失败终态。

所有状态事件在同一 IM 会话内按顺序处理。不同会话仍可并行，慢平台不会阻塞其他用户。

## 安装与挂载

```bash
pnpm add @zhin.js/service-activity-feedback @zhin.js/agent
```

在项目 `package.json` 的 `zhin.plugins` 中加入：

```json
{
  "zhin": {
    "plugins": [
      {
        "package": "@zhin.js/service-activity-feedback",
        "instanceKey": "activity-feedback"
      }
    ]
  }
}
```

## 配置

插件配置位于 `zhin.config.yml` 的实例命名空间：

```yaml
plugins:
  activity-feedback:
    enabled: true
    defaults:
      phases:
        active:
          private: { type: message, message: "正在处理中…" }
    platforms:
      icqq:
        phases:
          active:
            group: { type: reaction, emoji: "60" }
      discord:
        phases:
          active:
            channel: { type: typing }
    schedule:
      phases:
        finish:
          private: { type: message, message: "✅ 定时任务完成", removeDelay: 3000 }
```

配置按 `defaults → platforms.<platform> → endpoints.<platform:endpointKey>` 合并。每个 phase 可按 `private`、`group`、`channel` 分别配置。

## Phase 快速选择

`phase` 表示“Agent 现在处于哪一段生命周期”，不是可以随意命名的标签。当前只接受下面 6 个值；拼写错误会被 Schema 拒绝。

| phase | 何时出现 | 何时结束 | 新手建议 |
| --- | --- | --- | --- |
| `queued` | 用户请求已进入队列，但还没有开始执行 | Runtime 开始 processing，或排队被清除 | 并发较高时用轻量 `reaction`；无需表达排队时设为 `none` |
| `active` | Agent 正在处理、迭代或调用工具 | 回合完成、失败、取消，或切换到更具体的 `thinking` | 默认首选 `typing`；平台没有原生输入状态时使用可清理的 `message` |
| `thinking` | 模型产生 reasoning、工具后继续推理，或子 Agent 工作 | 回到 `active`，或回合/子任务结束 | 支持 edit 时用 `message` 展示动态文本；否则用 `typing` 或 `reaction` |
| `schedule_start` | 开启活动反馈的 Schedule Job 开始执行 | Job 完成或失败 | 建议使用 `message`，让无人值守任务有明确开始记录 |
| `schedule_finish` | Schedule Job 成功结束 | 作为短暂终态，按 `removeDelay` 清理 | 建议使用成功 `message`，默认短暂展示 3 秒 |
| `schedule_error` | Schedule Job 失败 | 作为短暂终态，按 `removeDelay` 清理 | 建议保留明显的失败 `message`，必要时增大 `removeDelay` |

前三个 phase 只用于普通交互回合；后三个只用于显式启用 `activityFeedback` 的 Schedule。Schedule 简写配置中的 `start`、`finish`、`error` 会分别映射到 `schedule_start`、`schedule_finish`、`schedule_error`：

```yaml
plugins:
  activity-feedback:
    schedule:
      phases:
        start:
          group: { type: message, message: "⏰ 定时任务开始" }
        finish:
          group: { type: message, message: "✅ 定时任务完成", removeDelay: 3000 }
        error:
          group: { type: message, message: "❌ 定时任务失败", removeDelay: 10000 }
```

## Scene 与呈现类型

每个 phase 下只能使用 3 个场景键：

- `private`：私聊或一对一会话。
- `group`：群聊。
- `channel`：频道或服务器中的频道会话。

每个场景的 `type` 只接受以下 4 个枚举：

| type | 相关字段 | 什么时候推荐 |
| --- | --- | --- |
| `reaction` | `emoji` | 群聊中需要低打扰提示，且 Endpoint 支持 reaction；停止时移除 |
| `typing` | 无必填扩展字段 | 平台提供原生输入状态时的默认选择；Runtime 会定时续期 |
| `message` | `message`，可选 `removeDelay` | 需要明确文本、动态更新或 Schedule 终态时；清理与编辑取决于 Endpoint 能力声明 |
| `none` | 无 | 某个 phase 或场景不应产生任何反馈时 |

`autoRemove` 默认是 `true`；`removeDelay` 单位为毫秒，负值会在运行时按 `0` 处理。完整字段、枚举和默认值见[自动生成配置字段参考](/configuration/generated#activity-feedback)。

实际执行以 Endpoint 的 `operations` 声明为准。配置请求了平台不支持的类型时，插件会降级到该 Endpoint 可安全清理的 reaction、typing、message 或 none，不会调用未声明的隐藏能力，也不会伪造平台 message id。

## Schedule

Schedule Job 需要启用 `activityFeedback`，并且通知目标能够解析为 IM 会话，才会产生状态：

```yaml
activityFeedback: true
notify:
  channel: im
```

完成与失败状态默认显示 3 秒；可以在对应 phase 上用 `removeDelay` 调整。
