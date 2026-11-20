# 消息模板占位符

插件发出的文本（`message.$reply('…')`、`outboundMessageToken.send(...)`、命令返回值、文本段 `{ type: 'text' }`）在出站时会做一次模板替换：`${path}` 按发出这条消息的会话和账号填值。所有插件都能用；插件自己的配置文本（如 group-suite 的入群欢迎语、问答回答）交给出站链后同样生效。

```text
欢迎 ${sender.name}！发送 ${bot.menu} 查看功能，${command.checkin} 每日签到
```

同一个实例里不同账号可以有不同的命令前缀和菜单关键词，同一句模板会按**发出消息的账号**分别渲染：前缀为 `#` 的账号得到 `#菜单`、`#checkin`，前缀为 `/` 的账号得到 `/菜单`、`/checkin`，没有前缀的账号得到 `菜单`、`checkin`。

## 规则

- **只做路径查找**：占位符只能是属性路径（`a.b.c`、`a[0].b`），按白名单字段逐级取自有数据属性。`${1+1}`、`${fn()}`、未知字段、值为空或不存在的路径都**原样保留**在文本里，不报错、不执行任何代码。
- **只扫描一次**：替换进去的值不会再被当成模板。用户可控的内容（昵称、消息正文、正则捕获组）只当数据：昵称写成 `${bot.menu}` 的新成员，欢迎语里出现的就是字面的 `${bot.menu}`。
- **只有作者撰写的文本会展开**：插件代码与运营者配置里写的文本才是模板。经 `incoming` 传入的数据（`sender`、`message`）只作为填进去的值；标记为不受信任来源的内容（`untrustedContent(...)`，例如 Agent 模型输出、问答回答里的正则捕获组、Agent 入群欢迎里的昵称与群名）里的 `${…}` 不做替换。
- **把用户内容拼进自己的文本时必须分段**：插件把存储的用户内容（问答、关键词、昵称、错误信息里引用的用户输入……）拼进自己的回复再发出时，拼进去的部分必须用 `untrustedContent(...)` 单独分段，否则整段文本都会当模板展开——教会 `你好|你好 ${sender.name}` 后，确认消息会显示成「你好 Admin」。只有插件自己的文案留在模板文本里：

  ```ts
  import { untrustedContent } from '@zhin.js/core/runtime';
  const trust = { source: 'my-plugin.echo' };
  return ['已保存：「', untrustedContent(answer, trust), '」，发送 ${bot.menu} 查看'];
  ```
- **按需计算**：文本里没有 `${` 时什么都不算；前缀和菜单在第一次遇到占位符时算一次，`${command.*}` 只在文本里写了它时才列命令。

## 字段

所有占位符都至少两段（带点号），按分组列出：

| 写法 | 含义 |
|---|---|
| `${bot.adapter}` | 发送账号的适配器名（如 `qq`、`sandbox`） |
| `${bot.endpoint}` | 发送账号的 Endpoint 标识（`conversation.endpoint.id`） |
| `${bot.endpointId}` | 平台报告的账号实例名（如 ICQQ 的 uin、sandbox 的 bot 名）；只在回复带有它的入站消息时有 |
| `${bot.prefix}` | 发送账号的命令前缀；没有前缀时为空字符串 |
| `${bot.menu}` | 发送账号的菜单入口：前缀 + 菜单关键词（根配置 `menuKeyword`，默认「菜单」/ `menu`）；菜单关键词按这次发送的语言取（`$reply` 用入站消息的语言，与 `message.commandMenu` 一致；没有语言时用项目语言）。`menuKeyword: false` 关闭菜单时**原样保留**（不替换成空串，以免句子缺了一半而没人察觉），并在日志里告警一次（`reason=menu_disabled`），提示把它从文本里删掉或打开菜单 |
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

## 旧写法

旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 以及单段的 `${menu}`、`${prefix}` 等不再展开，也不会自动迁移，会按原样发出。group-suite 在首次用到时（入群欢迎、群里第一条消息、问答命中或教学时）检测欢迎语与已存问答里的旧写法，按账号和文本各告警一次，并给出对应的新写法（如 `{name} → ${sender.name}`、`${menu} → ${bot.menu}`）。

Agent 会话欢迎（Console「会话运营」，ADR 0037）沿用自己的 `{members}` / `{nickname}` / `{group}` / `{rules_url}` 变量：它们可以一次欢迎多名成员，`${sender.*}` 只能表示一个人，且已存模板与 Console 预览依赖这套变量。变量填进去的昵称、群名、群规链接按数据发送（不受信任分段），其余运营者写的文本仍是出站模板，可以写 `${bot.menu}`。

## 与配置文件里的环境变量引用

配置文件的字符串在加载时先做环境变量展开：只有一个名字的 `${NAME}` 会替换成环境变量（不存在时为空）。出站模板的占位符都带点号，不会被当成环境变量，配置文件、群内 `功能 设置` 写入的配置、数据库里的内容和插件代码里写法完全相同。

## 相关

- [group-suite 入群欢迎与问答回答](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/README.md#欢迎语与问答回答里的占位符)
- [群欢迎方案](../solutions/group-welcome.md)
