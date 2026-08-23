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
  "package": "@zhin.js/service-activity-feedback",
  "instanceKey": "activity-feedback"
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

支持的 `type`：

- `reaction`：在触发消息上添加回应，停止时移除。
- `typing`：使用平台原生输入状态，并定时续期。
- `message`：发送状态消息；支持 edit 时会原位更新，支持 recall 时会在结束时撤回。
- `none`：关闭该 phase。

实际执行以 Endpoint 的 `operations` 声明为准。配置请求了平台不支持的类型时，插件会降级到该 Endpoint 可用的 typing、message 或 none，不会调用未声明的隐藏能力。

## Schedule

Schedule Job 需要启用 `activityFeedback`，并且通知目标能够解析为 IM 会话，才会产生状态：

```yaml
activityFeedback: true
notify:
  channel: im
```

完成与失败状态默认显示 3 秒；可以在对应 phase 上用 `removeDelay` 调整。
