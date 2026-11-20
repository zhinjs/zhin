# 消息模板占位符

插件发出的文本（`message.$reply('…')`、`outboundMessageToken.send(...)`、命令返回值、文本段 `{ type: 'text' }`）在出站时会做一次模板替换：`${path}` 按发出这条消息的会话和账号填值。所有插件都能用；插件自己的配置文本（如 group-suite 的入群欢迎语、问答回答）交给出站链后同样生效。

```text
欢迎 ${sender.name}！发送 ${bot.menu} 查看功能，${command.checkin} 每日签到
```

同一个实例里不同账号可以有不同的命令前缀和菜单关键词，同一句模板会按**发出消息的账号**分别渲染：前缀为 `#` 的账号得到 `#菜单`、`#checkin`，前缀为 `/` 的账号得到 `/菜单`、`/checkin`，没有前缀的账号得到 `菜单`、`checkin`。

## 规则

- **只做路径查找**：占位符只能是属性路径（`a.b.c`、`a[0].b`），按白名单字段逐级取自有数据属性。`${1+1}`、`${fn()}`、未知字段、值为空或不存在的路径都**原样保留**在文本里，不报错、不执行任何代码。
- **只扫描一次**：替换进去的值不会再被当成模板。用户可控的内容（昵称、消息正文、正则捕获组）只当数据：昵称写成 `${bot.menu}` 的新成员，欢迎语里出现的就是字面的 `${bot.menu}`。
- **不受信任的内容不展开**：标记为不受信任来源的内容（`untrustedContent(...)`，例如 Agent 模型输出、问答回答里的正则捕获组）里的 `${…}` 不做替换。
- **按需计算**：文本里没有 `${` 时什么都不算；前缀和菜单在第一次遇到占位符时算一次，`${command.*}` 只在文本里写了它时才列命令。

## 字段

所有占位符都至少两段（带点号），按分组列出：

| 写法 | 含义 |
|---|---|
| `${bot.adapter}` | 发送账号的适配器名（如 `qq`、`sandbox`） |
| `${bot.endpoint}` | 发送账号的 Endpoint 标识（`conversation.endpoint.id`） |
| `${bot.endpointId}` | 平台报告的账号实例名（如 ICQQ 的 uin、sandbox 的 bot 名）；只在回复带有它的入站消息时有 |
| `${bot.prefix}` | 发送账号的命令前缀；没有前缀时为空字符串 |
| `${bot.menu}` | 发送账号的菜单入口：前缀 + 菜单关键词（根配置 `menuKeyword`，默认「菜单」/ `menu`）；`menuKeyword: false` 关闭菜单时原样保留 |
| `${conversation.kind}` / `${conversation.id}` | 会话类型（`private` / `group` / `channel`）与会话 id |
| `${sender.id}` / `${sender.name}` / `${sender.roles}` | 这次发送所回应的人（见下方「主体」）；定时任务、跨会话发送时没有 |
| `${message.content}` | 入站消息的纯文本（由事件触发的发送为空） |
| `${message.segments[0].type}` 等 | 入站消息的结构化消息段 |
| `${message.id}` / `${message.timestamp}` / `${message.mentioned}` | 入站消息 id、到达时间（毫秒）、是否 @ 了机器人 |
| `${command.<路径>}` | **发出消息的插件自己的**命令在该账号下的写法（带前缀与 `commandNamespace`） |

`bot.endpoint` 与 `bot.endpointId` 含义不同，所以分成两个字段：前者是 zhin 给这个账号的标识，总是有；后者是平台自己的账号名，只有入站消息带上时才有。

### 主体：`sender`

`sender` 指「这次发送所回应的人」：

- 回复一条消息时，是那条消息的发送者；
- 由事件触发、没有入站消息的发送（如有人入群），是事件的主体——发送方插件把它作为 `incoming.sender` 交给出站链。group-suite 的入群欢迎就是这样把新成员传进来的，所以欢迎语里写 `${sender.name}` / `${sender.id}`。

```ts
await this.use(outboundMessageToken).send({
  requester: this.owner.id,
  conversation: notice.conversation,
  content: '欢迎 ${sender.name}！发送 ${bot.menu} 查看功能',
  incoming: { sender: { id: member.id, name: member.name || member.id }, content: '', timestamp: notice.timestamp },
});
```

### `${command.*}` 的写法

- 键是命令的静态路径段：`commands/checkin` → `${command.checkin}`，`commands/group/kick` → `${command.group.kick}`；参数目录（`[name]` 等）不算路径段。
- 命令名里的 `-` 写成 `_`：`commands/stats-rank` → `${command.stats_rank}`（插件本地名不允许 `_`，所以不会撞名）。以数字开头的段无法写成路径，不提供。
- 只列发出消息的插件自己的命令（最多 256 条）；别的插件的命令、在该会话被关闭的插件的命令、不存在的路径都原样保留。
- 一个命令如果还有子命令，只能通过子命令访问；`${command}`、`${command.group}` 这类非叶子路径原样保留。

## 与配置文件里的环境变量引用

配置文件的字符串在加载时先做环境变量展开：只有一个名字的 `${NAME}` 会替换成环境变量（不存在时为空）。出站模板的占位符都带点号，不会被当成环境变量，配置文件、群内 `功能 设置` 写入的配置、数据库里的内容和插件代码里写法完全相同。

## 相关

- [group-suite 入群欢迎与问答回答](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/README.md#欢迎语与问答回答里的占位符)
- [群欢迎方案](../solutions/group-welcome.md)
