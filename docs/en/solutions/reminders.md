---
title: Create reminders without AI
description: Fill missing reminder fields through chat and confirm the exact date, timezone and content before saving
---

# Create reminders without AI

With the persistent reminder plugin loaded, send `remind create 十分钟后 喝水`. The bot shows the exact date, timezone, content and conversation, then saves only after `确认`. Missing fields are requested separately. No model or Agent is required; natural-time phrases in this first version use Chinese syntax.

## Check the instance and timezone

Follow the [reminder plugin README](https://github.com/zhinjs/zhin/tree/main/plugins/utils/reminder) to install and load it with a persistent Database Host and the required Schedule Feature. Missing storage is a startup error, not an in-memory fallback.

Set the chosen reminder instance's timezone:

```yaml
timezone: Asia/Shanghai
```

The default is **UTC**. Local calendar expressions in the new `create` command use that explicit timezone, never an inferred sender or server timezone. Existing `at`, Console and Agent absolute timestamps still require an offset.

## Create and confirm

These examples assume a `/` account prefix and no plugin namespace; adjust both for your actual account and instance:

```text
/remind create 十分钟后 喝水
/remind create 明天九点 开会前检查资料
/remind create "明天下午三点半" 提交周报
/remind create 2027-01-01T09:00:00+08:00 新年会议
```

Send only `/remind create` to be asked for time and content. Quote an expression containing spaces in a command argument; a follow-up answer may contain the entire expression directly.

Review the absolute date, timezone, content and original conversation, then reply `确认`. No task exists before confirmation, and waiting does not move the displayed time. Follow-up answers need no command prefix. Reply `取消` or `cancel` to exit before starting another command; a command sent during a pending question may be interpreted as its answer.

Use `/remind list` to inspect and `/remind cancel <task ID>` to cancel your own reminder. Creation confirms persistent storage, not eventual platform delivery.

## Supported time expressions

| Expression | Meaning |
| --- | --- |
| `十分钟后`, `2小时后`, `一天后` | Fixed intervals; a day means 24 hours |
| `今天18:30`, `明天九点`, `后天九点半` | A local date and clock; nine without a period marker means 09:00 |
| `明天下午三点半`, `明天晚上九点` | Afternoon or evening in the configured timezone |
| `2027-01-01T09:00:00+08:00` | An absolute ISO timestamp with an explicit offset |

A bare `九点` does not guess a date, and an elapsed `今天九点` is not moved to tomorrow. Calendar recurrences such as `每天九点` or `每周一` are outside this flow. Existing `/remind every 3600 喝水` means a fixed interval, not the same local hour across daylight-saving changes.

Nonexistent or repeated local clocks during a timezone transition require an ISO timestamp with an offset. Timeout creates no task; invalid answers do not extend the overall deadline. Plugin retirement or a generation change ends an old question.

## Delivery and ownership

Chat creates a personal reminder for the exact original account, conversation kind and ID, parent and thread. Another sender, account or similarly named topic cannot list or cancel it.

Questions and confirmation accept plain text, so buttons, Markdown and images are optional. Delivery uses the shared message pipeline. An uncertain delivery is not automatically retried; inspect the original conversation and task first.

The Console [administrator task center](../paths/console.md#administrator-task-center) manages a separate task category with explicitly selected targets. Its time field still requires ISO timestamps with an offset; this chat flow does not add natural-time parsing to administrator tasks.
