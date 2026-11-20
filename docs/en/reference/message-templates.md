# Message Template Placeholders

Text a plugin sends (`message.$reply('…')`, `outboundMessageToken.send(...)`, a command's return value, a `{ type: 'text' }` segment) goes through one template pass on the way out: each `${path}` is filled for the conversation and the account that send the message. Every plugin can use it, and plugin-configured text (such as group-suite's welcome message and taught answers) gets it too once it is handed to the outbound chain.

```text
Welcome ${sender.name}! Send ${bot.menu} to see what I can do, ${command.checkin} to check in
```

Accounts of the same instance may have different command prefixes and menu keywords; the same template renders for the **account that sends the message**: an account with prefix `#` gets `#menu` / `#checkin`, one with `/` gets `/menu` / `/checkin`, one without a prefix gets `menu` / `checkin`.

## Rules

- **Path lookup only**: a placeholder is a property path (`a.b.c`, `a[0].b`) resolved step by step through own data properties of the whitelisted fields. `${1+1}`, `${fn()}`, unknown names and paths without a value **stay in the text as written**; nothing is executed.
- **One pass**: substituted values are never scanned again. User-controlled values (nicknames, message text, regex captures) are data: a new member whose nickname is `${bot.menu}` is welcomed with a literal `${bot.menu}`.
- **Untrusted content is not expanded**: `${…}` inside content marked as coming from an untrusted source (`untrustedContent(...)`: Agent model output, regex captures in taught answers) is left alone.
- **Computed on demand**: text without `${` costs nothing; the prefix and menu are resolved once at the first placeholder, and `${command.*}` lists commands only for a text that names it.

## Fields

Every placeholder has at least two segments, grouped as follows:

| Placeholder | Meaning |
|---|---|
| `${bot.adapter}` | Adapter name of the sending account (e.g. `qq`, `sandbox`) |
| `${bot.endpoint}` | Endpoint id of the sending account (`conversation.endpoint.id`) |
| `${bot.endpointId}` | Account instance name as the platform reports it (an ICQQ uin, a sandbox bot name); only when replying to an incoming message that carries it |
| `${bot.prefix}` | Command prefix of the sending account; empty when it has none |
| `${bot.menu}` | Menu entry of the sending account: prefix + menu keyword (root `menuKeyword`, default `菜单` / `menu`); left as written when `menuKeyword: false` turns the menu off |
| `${conversation.kind}` / `${conversation.id}` | Conversation kind (`private` / `group` / `channel`) and id |
| `${sender.id}` / `${sender.name}` / `${sender.roles}` | The person this send answers (see "Subject" below); absent for scheduled and cross-conversation sends |
| `${message.content}` | Plain text of the incoming message (empty for an event-triggered send) |
| `${message.segments[0].type}` … | Structured segments of the incoming message |
| `${message.id}` / `${message.timestamp}` / `${message.mentioned}` | Incoming message id, arrival time (ms), whether the bot was @mentioned |
| `${command.<path>}` | How **the sending plugin's own** command is typed on that account (prefix and `commandNamespace` included) |

`bot.endpoint` and `bot.endpointId` mean different things, so they stay two fields: the first is zhin's id for the account and is always there; the second is the platform's own account name, present only when an incoming message carries it.

### Subject: `sender`

`sender` is "the person this send answers":

- when replying to a message, its author;
- for a send triggered by an event without an incoming message (someone joined), the subject of the event, which the sending plugin passes to the outbound chain as `incoming.sender`. group-suite's welcome passes the new member this way, so welcome text uses `${sender.name}` / `${sender.id}`.

```ts
await this.use(outboundMessageToken).send({
  requester: this.owner.id,
  conversation: notice.conversation,
  content: 'Welcome ${sender.name}! Send ${bot.menu} to see what I can do',
  incoming: { sender: { id: member.id, name: member.name || member.id }, content: '', timestamp: notice.timestamp },
});
```

### Writing `${command.*}`

- Keys are the command's static path segments: `commands/checkin` → `${command.checkin}`, `commands/group/kick` → `${command.group.kick}`; parameter directories (`[name]` …) are not segments.
- Write `-` as `_`: `commands/stats-rank` → `${command.stats_rank}` (plugin-local names never contain `_`, so this cannot collide). A segment that starts with a digit cannot be written as a path and is not offered.
- Only the sending plugin's own commands are listed (at most 256); other plugins' commands, commands of a plugin switched off in that conversation and unknown paths stay as written.
- A command that has subcommands is reachable only through them; non-leaf paths such as `${command}` or `${command.group}` stay as written.

## Environment references in configuration files

Configuration strings are environment-expanded when they load: a single-name `${NAME}` is replaced by the environment variable (empty when unset). Outbound placeholders are always dotted, so they are never taken as environment references: write them the same way in configuration files, values saved by the in-chat `feature set`, database content and plugin code.

## See also

- [group-suite welcome and taught answers](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/README.md)
- [Group welcome](../solutions/group-welcome.md)
