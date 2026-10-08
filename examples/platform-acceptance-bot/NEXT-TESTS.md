# 第二轮实机验收

八个平台的基础文本往返已由用户确认通过；Discord 已覆盖私信和服务器文字频道。下面按顺序补齐证据；每个平台分别运行，样本 ID 不复用，操作间隔至少 5 秒。

## 当前先做：Email 重启与探针去重

这一步沿用现有白名单与配置，不需要新增账号。停止当前 Email 测试进程后，运行：

```sh
pnpm --filter platform-acceptance-bot start:email
```

1. 用白名单发件人发送主题为空的纯文本邮件，正文 `/acceptance probe:emailrestart01`，确认收到对应回复。
2. 再发一封相同正文的新邮件，确认没有第二次探针回复。每次发送间隔至少 5 秒；等待至少两个配置的轮询周期。
3. 停止并再次运行同一启动命令。发送相同正文的新邮件，确认重启后仍不重复回复。
4. 发送正文 `/acceptance probe:emailrestart02` 的新邮件，确认重启后新样本仍能回复。

不要在测试收件箱中提前打开这些邮件；当前轮询仅取未读邮件。记录两次启动日志和两条成功回复。重复样本无回复需结合 `.acceptance/email/` 中的执行记录确认被阻止，不能仅凭等待认定通过。这验证探针的持久化去重，不代表 IMAP 入站事件去重。

## 1. 媒体和消息操作

由用户在现有 `.env` 中自行设置：

```dotenv
ACCEPTANCE_ACTIONS=reply-text,reply-image,reply-quote,reply-recall,reply-interaction,account-marker
```

停止并重新运行原来的 `dev:<平台>`。另开终端运行 `observe:<平台> 5m`（例如 `pnpm --filter platform-acceptance-bot observe:telegram 5m`），在白名单会话逐条发送：

```text
/acceptance probe:text0002 action:reply-text
/acceptance probe:image002 action:reply-image
/acceptance probe:quote002 action:reply-quote
/acceptance probe:recall02 action:reply-recall
/acceptance probe:interact2 action:reply-interaction
```

逐项核对：文本别名正确、图片可见、引用本次消息、撤回消息消失、交互在 60 秒内完成。交互可能使用文本回退，请记录实际表现。图片探针是 48×48 彩色棋盘 PNG；不要把附带文本或普通附件发送成功当作图片显示成功。平台不支持的能力记录为不支持，不能算通过。

把相同 `text0002` 再发一次，确认没有第二条探针回复。这只验证探针样本去重，平台入站事件去重需要独立测试。

## 2. 生产重启和断线恢复

先保存一次成功基线和观察报告，再按[完整指南的阶段记录步骤](../../docs/contributing/platform-acceptance-runner.md#记录人工观察和故障阶段)记录 begin/end。

- 生产重启：用 `start:<平台>` 启动，成功探针后停止，重新启动并发送新样本。核对 PID 改变且恢复收发。
- NapCat/OneBot11：只重启专用测试桥，恢复后发送新样本。两者连接同一桥时轮流测试。
- Telegram/QQ：只对测试进程的连接施加中断；不要关闭整机网络。需要专门的连接故障工具后再执行这一项。
- HMR：在 dev 模式修改生成命令的描述，重载后发送新样本，核对 generation 改变且只回复一次。

失败、未知结果和恢复耗时都保留；只有截图不足以证明故障阶段通过。

## 3. 需要准备的账号和入口

| 下一项 | 准备内容 |
| --- | --- |
| 群聊 | 四个平台各一个允许测试的群，Bot 的消息/媒体/撤回权限及测试群 ID |
| 双账号 | Telegram 第二个 Bot；QQ 官方第二个应用；NapCat/OneBot11 第二个独立 QQ 登录和桥实例 |
| 反向 WS / HTTP | 专用桥的相应入口和鉴权配置，不能与生产桥混用 |
| Webhook | Telegram/QQ 回调可达的测试 HTTPS 域名和转发入口 |

当前 example 已支持账号 B 以及原四个平台的其他模式，变量和配置步骤见 [README](./README.md)。账号 B 必须使用第二套独立身份；配置可生成不代表实机隔离已通过。凭据只由用户写入本地环境文件，不发到聊天。

## 4. 长跑

进阶短测通过后，先 24h，再 72h。成功基线后执行 `observe:<平台> 24h`，按现有策略至少每 15 分钟发一次新文本探针；观察器只记录，不自动发消息。重启会打断进程连续性，应开始新报告。

报告保存在 `.acceptance/<平台>/reports/`。分享前核对日志没有凭据；失败项附对应终端报错和接收端表现。
