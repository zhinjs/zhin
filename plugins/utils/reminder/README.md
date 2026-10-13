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
  "plugins": [{ "package": "@zhin.js/plugin-reminder", "instanceKey": "reminder" }]
}
```

根应用从 `zhin.js` 继承 Stable Command Feature；上面的直接 Command 依赖确保子插件解析到同一物理 provider。安装命令会添加插件挂载；手动维护时同样使用上述清单。启用支持持久状态原子更新的 Database Host。缺少持久数据库或精确目标投递 Host 时启动明确失败，不会降级为内存保存。SQLite、PostgreSQL、MySQL 的状态能力由框架 Database Host 提供；本插件回归使用真实 SQLite 文件。

```yaml
plugins:
  reminder:
    timezone: UTC
    maxTasks: 20
    maxTasksPerSender: 10
    batchSize: 5
    missedGraceSeconds: 15
```

配置统一由 Schema 校验；修改仅重载插件。timezone 是有效的 IANA 时区，只影响显示，默认 UTC。绝对时间必须显式包含 `Z` 或 `±hh:mm`，没有隐式本地时间转换。多个实例应显式配置不同的 `commandNamespace`，例如 `personal` 和 `work`；使用时在指令前添加对应命名空间。Endpoint 的 `commandPrefix` 决定指令前缀。

## 指令

以下示例省略 Endpoint 前缀与插件显式命名空间。各指令的 `--help` 提供参数说明。

```text
remind after 600 十分钟后休息
remind at 2027-01-01T09:00:00+08:00 新年会议
remind every 3600 喝水
remind list
remind cancel <任务 ID>
```

延迟是 1 秒至一年；周期是 60 秒至一年；内容是 1–500 字符。时间必须在未来一年内。指令权限经过框架 PermissionHost；插件没有额外权限旁路或取消其他发送者任务的管理员接口。

## 执行与恢复

`schedules/poll/index.ts` 每 5 秒通过当前 owner 的 ScheduleContext 解析服务，没有队列积压时通常在目标时间后 5 秒内扫描；平台投递耗时不计入此保证。服务不保存 Message、客户端或旧 snapshot。周期是固定秒数的间隔，不是墙上时钟的 cron，不受夏令时跳变影响。

- 一次性任务：停机错过后恢复时补发至多一次。
- 周期任务：超过 `missedGraceSeconds` 的轮次跳过，推进至未来，停机后不连发遗漏轮次。
- 每轮最多投递 `batchSize` 条，逐条执行；同一服务扫描不重叠，持久原子 claim 防止同一任务并发领取。
- 投递前持久记录为“投递中或未确认”。平台返回非空消息 ID 才记为完成；明确未发送或拒绝会停止任务。未知错误、没有 ID、进程在 claim 后崩溃、投递成功但状态落盘失败都保持未确认，**不自动重试**。用户核对原会话后取消或重新创建。
- 取消不撤销已开始的外部投递。完成回写不会覆盖在途取消。重启或热重载保留未知状态，避免重复消息。

这是保守的至多一次尝试策略，不是 outbox 或 exactly-once 投递。claim 后、实际发送前崩溃可能丢失一次提醒；周期任务遇未知投递也会暂停，需要用户处理。

每实例最多保留 32 条记录、每发送者在会话内最多 10 条活跃任务；总编码大小限制为 60 KiB。完成或取消记录在新建任务时优先淘汰，未知任务持续占用限额，直到显式取消。减少配置上限不删除既有活跃任务，只限制继续创建。

## 显式本地检查

插件通过正式 `pluginVerificationToken` 暴露 `local-state` 检查。inspect/checks 只显示副作用，只有用户显式 verify 才写入、读回并删除独立探针键。探针 TTL 为 60 秒。验证被取消或热重载打断时，清理拒绝会使检查明确失败，短 TTL 使残留探针失效；不能将被打断的旧代结果视为当前验证通过。检查不创建可投递任务、不发送消息，仅证明当前 owner 的数据库状态可读写；不证明平台投递或调度健康。

## 目录

```text
plugin.ts                 # Schema、owner 服务资源及显式检查
src/                      # 服务、状态契约与指令 helper
commands/remind/*/index.ts # 集中参数声明与标准 Command dispatcher
schedules/poll/index.ts   # 正式 Schedule Feature 入口
```
