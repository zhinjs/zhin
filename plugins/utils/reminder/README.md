# 持久提醒

使用 Plugin Runtime、持久状态与精确 DeliveryTarget 的个人提醒插件。任务绑定创建者和原会话；群聊其他用户、其他 Endpoint、频道父级或线程不能查看和取消。

## 安装

```bash
pnpm add @zhin.js/command @zhin.js/schedule-feature
zhin install @zhin.js/plugin-reminder
```

在项目根 `package.json#zhin` 合并以下挂载（保留已有条目）：

```json
{
  "features": [{ "package": "@zhin.js/schedule-feature" }],
  "plugins": [
    { "package": "@zhin.js/plugin-reminder", "instanceKey": "reminder" }
  ]
}
```

根应用从 `zhin.js` 继承 Stable Command Feature；上面的直接 Command 依赖确保子插件解析到同一物理 provider。安装命令会添加插件挂载；手动维护时同样使用上述清单。启用支持持久状态原子更新的 Database Host。缺少持久数据库或精确目标投递 Host 时启动明确失败，不会降级为内存保存。SQLite、PostgreSQL、MySQL 的状态能力由框架 Database Host 提供；本插件回归使用真实 SQLite 文件。

```yaml
configVersion: 2
plugins:
  reminder: "@zhin.js/plugin-reminder"
reminder:
  timezone: UTC
  maxTasks: 20
  adminMaxTasks: 20
  maxTasksPerSender: 10
  batchSize: 5
  missedGraceSeconds: 15
```

配置统一由 Schema 校验；修改仅重载插件。timezone 是有效的 IANA 时区，默认 UTC，用于 `create` 指令的本地日期解析和时间显示；不猜服务器或发送者时区。原有 `at`、Agent 工具和 Console 的绝对时间仍必须显式包含 `Z` 或 `±hh:mm`。多个实例应显式配置不同的 `commandNamespace`，例如 `personal` 和 `work`；使用时在指令前添加对应命名空间。Endpoint 的 `commandPrefix` 决定指令前缀。

## 指令

以下示例省略 Endpoint 前缀与插件显式命名空间。各指令的 `--help` 提供参数说明。

```text
remind create 十分钟后 喝水
remind create "明天下午三点半" 提交周报
remind create
remind after 600 十分钟后休息
remind at 2027-01-01T09:00:00+08:00 新年会议
remind every 3600 喝水
remind list
remind cancel <任务 ID>
```

延迟是 1 秒至一年；周期是 60 秒至一年；内容是 1–500 字符。时间必须在未来一年内。指令权限经过框架 PermissionHost；插件没有额外权限旁路或取消其他发送者任务的管理员接口。

`create` 创建一次性个人提醒，不依赖 AI。缺少时间或正文时逐项补问，随后用纯文字显示绝对日期、IANA 时区、正文和完整原会话；只有明确回复 `确认` 才保存。后续回答不加命令前缀；输入 `取消` 或 `cancel` 退出后再发新命令。每步有时限且整个流程最多三分钟，输错不会无限续期。超时、取消或热重载结束旧流程，均不创建任务。确认时已过期的时间不会自动顺延。

自然时间仅支持有限中文语法：如 `10分钟后`、`一天后`（固定 24 小时）、`今天18:30`、`明天九点`、`后天九点半`、`明天下午三点半`；也支持带 offset 的 ISO 时间。裸写 `九点`、日历周期和夏令时重复／不存在时刻不会猜测。按钮、Markdown 和图片均非必需；非聊天 CLI 没有真实发送者和交互能力时不能创建。完整操作与边界见[无需 AI 的提醒指南](https://zhin.js.org/solutions/reminders)。

## 执行与恢复

`schedules/poll/index.ts` 每 5 秒通过当前 owner 的 ScheduleContext 解析服务，没有队列积压时通常在目标时间后 5 秒内扫描；平台投递耗时不计入此保证。服务不保存 Message、客户端或旧 snapshot。周期是固定秒数的间隔，不是墙上时钟的 cron，不受夏令时跳变影响。

- 一次性任务：停机错过后恢复时补发至多一次。
- 周期任务：超过 `missedGraceSeconds` 的轮次跳过，推进至未来，停机后不连发遗漏轮次。
- 每轮最多投递 `batchSize` 条，逐条执行；同一服务扫描不重叠，持久原子 claim 防止同一任务并发领取。
- 投递前持久记录为“投递中或未确认”。平台返回非空消息 ID 才记为完成；明确未发送或拒绝会停止任务。未知错误、没有 ID、进程在 claim 后崩溃、投递成功但状态落盘失败都保持未确认，**不自动重试**。用户核对原会话后取消或重新创建。
- 取消不撤销已开始的外部投递。完成回写不会覆盖在途取消。重启或热重载保留未知状态，避免重复消息。

这是保守的至多一次尝试策略，不是 outbox 或 exactly-once 投递。claim 后、实际发送前崩溃可能丢失一次提醒；周期任务遇未知投递也会暂停，需要用户处理。

`maxTasks` 限制每实例**聊天个人提醒池**的活跃任务（待触发或未确认）；`adminMaxTasks` 单独限制**管理员提醒池**的活跃任务（待执行、暂停或未确认）。两池配额独立，默认各 20 条，活跃任务总量可以达到两项之和，不能把 `maxTasks` 当作两池合计上限。每池状态硬上限分别为 32 条、60 KiB，管理员池大小包含有界操作确认记录；个人池仍有每发送者在同一会话内最多 10 条的独立限制。完成或取消历史在新建时优先淘汰，未知任务持续占用配额。降低配置不删除既有活跃任务，只限制继续创建。

## Console 管理员任务

插件通过正式 `pluginTaskProviderToken` 提供独立的管理员提醒。管理员经已鉴权的 Console Host 新建时选择精确 Endpoint、会话、父容器及线程；插件不伪造聊天发送者。管理员任务不会进入 `remind list` 或个人工具列表，聊天用户即使知道管理员任务 ID 也不能用 `remind cancel` 取消；管理员任务入口同样不列出或管理聊天个人任务。

创建和编辑参数为 `{ text, at, intervalSeconds? }`：内容 1–500 字，首次执行时间须为未来一年内、包含 `Z` 或 `±hh:mm` 的 ISO 时间；可选周期是 60 秒至一年的整数。`timezone` 按当前实例配置明确显示，固定秒数周期不按夏令时调整。更换目标必须取消旧任务并新建，不把在途或已投递消息迁移到其他会话。

- 待执行任务可暂停或取消；编辑须先暂停，编辑后仍暂停，确认后再恢复。
- 已过期的一次性暂停任务不能直接恢复，须先编辑未来时间；周期恢复会跳过错过轮次。
- 投递前持久记录为 `unknown`，仅平台确认消息 ID 后记为完成或进入下一周期。未确认任务不能恢复、编辑或重试，核对目标会话后可取消并另建。
- 取消不能撤回已经开始的外部投递，完成回写也不会覆盖在途取消。状态仅描述调度事实，不证明当前目标存在、平台已连接或消息可送达；暂停、取消不需要探测外部目标。
- 两池共用现有扫描 worker、`batchSize` 和统一 `sendTarget` 链路，不启动第二个定时调度；扫描轮转优先池，跨 tick 保留轮转位置，`batchSize: 1` 时也不会因另一池持续有待投递任务而饥饿。任务和操作确认持久化，HMR 与进程重启不会重试未确认投递。

管理员操作带客户端 UUID `requestId` 与最近读取的 `expectedRevision`。创建时 `requestId` 即任务 ID；状态与操作确认在同一次持久 CAS 中写入。相同 ID、相同规范化请求可读取当前快照核对，ID 被用于其他请求则冲突；新操作使用旧 revision 也会冲突，需要刷新并重新确认。快照 `receipts` 只包含最近至多 128 次操作的 ID、任务 ID 和操作类型，**不是平台投递回执**，不包含请求摘要。历史任务淘汰不重置 revision；确认记录已淘汰时不能自动用旧 revision 重放。初次空列表的 revision 稳定，读取不会产生新的任务版本。

## 显式本地检查

插件通过正式 `pluginVerificationToken` 暴露 `local-state` 检查。inspect/checks 只显示副作用，只有用户显式 verify 才写入、读回并删除独立探针键。探针 TTL 为 60 秒。验证被取消或热重载打断时，清理拒绝会使检查明确失败，短 TTL 使残留探针失效；不能将被打断的旧代结果视为当前验证通过。检查不创建可投递任务、不发送消息，仅证明当前 owner 的数据库状态可读写；不证明平台投递或调度健康。

## 目录

```text
plugin.ts                 # Schema、owner 服务资源及显式检查
src/                      # 服务、状态契约与指令 helper
commands/remind/*/index.ts # 集中参数声明与标准 Command dispatcher
schedules/poll/index.ts   # 正式 Schedule Feature 入口
```

## Agent 工具与技能

启用 `@zhin.js/tool` 与 `@zhin.js/skill` Feature 后，本插件提供技能 `reminder` 与工具：

| 工具              | 说明                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `reminder_create` | 创建一次性（`after` / `at`）或周期（`every_seconds`）提醒；需批准 |
| `reminder_list`   | 列出当前发送者在当前会话的提醒                                    |
| `reminder_cancel` | 按 id 取消；需批准                                                |

与原生 `schedule_add` 的区别：本插件到点**向会话发送提醒文案**；`schedule_*` 到点**再次唤醒 Agent**（可带 cron / 工作日等）。绝对时间仍须带 `Z` 或 `±hh:mm`。

### 事务化任务存储

提醒与管理员 RSS 的任务、认领、操作回执和文章明细使用独立数据表，在一个事务中提交；原 CAS JSON 只用于首次迁移。支持 SQLite、MySQL、PostgreSQL，升级须完整重启，不能与旧版本进程混写。`unknown` 投递仍不会自动重试。迁移和字段说明见[结构化存储](../../../docs/operations/structured-storage.md)。
