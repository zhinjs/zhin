# 记账

`@zhin.js/plugin-ledger` 是个人消费账本：按用户隔离保存每笔消费，按今日、本周、本月汇总并给出分类明细；群聊中不显示金额；可订阅每日私信日报。不依赖 AI。

## 安装

```bash
pnpm add @zhin.js/command @zhin.js/schedule-feature
zhin install @zhin.js/plugin-ledger
```

在项目根 `package.json#zhin` 合并以下挂载（保留已有条目）：

```json
{
  "features": [{ "package": "@zhin.js/schedule-feature" }],
  "plugins": [
    { "package": "@zhin.js/plugin-ledger", "instanceKey": "ledger" }
  ]
}
```

需要持久 Database Host（SQLite、PostgreSQL、MySQL 均可）；缺少时插件启动失败，不会退回内存。每日日报需要 Schedule Feature 和支持精确目标投递的 Outbound Host；没有时记账和查询照常可用，只是不能开启日报。

```yaml
configVersion: 2
plugins:
  ledger: "@zhin.js/plugin-ledger"
ledger:
  timezone: Asia/Shanghai
  reportTime: "22:00"
  reportWhenEmpty: false
```

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `timezone` | `Asia/Shanghai` | 计算今日、本周（周一开始）、本月和日报日期的 IANA 时区；无效时启动失败 |
| `reportTime` | `22:00` | 日报发送时间（`HH:MM`，按 `timezone`） |
| `reportWhenEmpty` | `false` | 当天没有记账时是否仍发送日报 |

## 指令

以下示例省略 Endpoint 的命令前缀。每条指令也有英文名（括号内），`--help` 显示参数说明。

| 指令 | 说明 |
| --- | --- |
| `记 <类别> <金额> [备注]`（`ledger-add`） | 记一笔，例如 `记 午饭 18.5 和同事`。回复带编号 `#1` |
| `今日消费` / `本周消费` / `本月消费`（`ledger-today` / `ledger-week` / `ledger-month`） | 合计、笔数和按类别的明细与占比 |
| `分类统计 [今日\|本周\|本月\|全部]`（`ledger-stats`） | 每个类别的合计、笔数、平均、最大单笔和占比，默认本月 |
| `账单 [今日\|本周\|本月\|全部]`（`ledger-list`） | 最新 20 笔账目及编号，默认本月 |
| `删账 <编号>`（`ledger-delete`） | 删除自己的一笔账目 |
| `记账日报 [开启\|关闭\|状态]`（`ledger-report`） | 订阅或取消每日私信日报，默认查看状态 |

### 金额

金额按整数“分”保存，解析时不经过浮点数，`0.1 + 0.2` 合计就是 `¥0.30`。可写 `18`、`18.5`、`18.50`、`¥18.5`、`18.5元` 或全角数字；最多两位小数，必须大于 0，单笔不超过 ¥1000000.00。负数、`1e3`、`1,000` 等写法会被拒绝并提示正确格式。类别最多 20 个字且不能是纯数字，备注最多 100 个字。

### 数据隔离与删除

账目按“适配器 + Bot 账号（Endpoint）+ 发送者”隔离：同一个人在私聊和群里看到的是同一本账，别人看不到也删不了。编号按用户递增，删除后不复用；`删账` 只在自己的账目里查找编号。

### 群聊隐私

群聊和频道里不显示金额：

- `记`、`删账` 的回复把金额显示为 `¥***`。
- 汇总、分类统计和账单优先私信发送完整内容，群里只回复“已私信发送给你”。
- 平台无法私信时（没有主动投递能力，或投递失败，例如平台不允许给群成员发私信），群里回复隐藏金额的版本，只保留类别和笔数，并提示私聊查看。

是否能私信由运行时能力决定（Outbound Host 是否提供精确目标投递以及投递是否成功），不按平台名单判断。

### 每日日报

发送 `记账日报 开启` 订阅。插件每分钟检查一次，按 `timezone` 到达 `reportTime` 后给订阅者私信当天的合计和分类明细，每人每天最多一次；当天没有记账时默认不发送。在群里开启时会先私信一条确认，私信失败则不开启并提示先私聊 Bot。在 `reportTime` 之后开启的，从第二天开始发送。投递失败只记录日志，当天不重试。

## 开发

```bash
pnpm --filter @zhin.js/plugin-ledger build
pnpm --filter @zhin.js/plugin-ledger check
pnpm --filter @zhin.js/plugin-ledger test
```

测试使用 `@zhin.js/testing` 的 `FakePlugin` 与 `FakeClock`，覆盖金额与输入解析、用户隔离、群聊隐私、删除权限、时区下的日/周/月边界和日报调度。

## 语言

指令反馈跟随当前发送者语言；英文环境的时间范围为 `today / week / month / all`，日报操作为 `on / off / status`，中文环境仍使用对应中文输入。命令路径与已有别名保持不变，提示中的调用头由当前 Endpoint 的实际前缀及插件命名空间生成。

每日日报在开启时固定语言，之后修改个人偏好不改变已开启日报。旧数据库的日报仍按中文发送，启动时仅增补声明的可空语言列。语言不改变配置时区、人民币金额格式或群聊金额隐私。
