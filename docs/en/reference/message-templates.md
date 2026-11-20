# Message Template Placeholders

Text a plugin sends (`message.$reply('…')`, `outboundMessageToken.send(...)`, a command's return value, a `{ type: 'text' }` segment) goes through one template pass on the way out: each `${path}` is filled for the conversation and the account that send the message. Every plugin can use it, and plugin-configured text (such as group-suite's welcome message and taught answers) gets it too once it is handed to the outbound chain.

```text
Welcome ${sender.name}! Send ${menu} to see what I can do, ${command.checkin} to check in
```

Accounts of the same instance may have different command prefixes and menu keywords; the same template renders for the **account that sends the message**: an account with prefix `#` gets `#menu` / `#checkin`, one with `/` gets `/menu` / `/checkin`, one without a prefix gets `menu` / `checkin`.

## Rules

- **Path lookup only**: a placeholder is a property path (`a.b.c`, `a[0].b`) resolved step by step through own data properties of the whitelisted fields. `${1+1}`, `${fn()}`, unknown names and paths without a value **stay in the text as written**; nothing is executed.
- **One pass**: substituted values are never scanned again. User-controlled values (nicknames, message text, regex captures) are data: a new member whose nickname is `${menu}` is welcomed with a literal `${menu}`.
- **Untrusted content is not expanded**: `${…}` inside content marked as coming from an untrusted source (`untrustedContent(...)`: Agent model output, regex captures in taught answers) is left alone.
- **Computed on demand**: text without `${` costs nothing; the prefix and menu are resolved once at the first placeholder, and `${command.*}` lists commands only for a text that names it.
- Brace spellings (`{name}`, `{id}`, `{sender}`) are not placeholders and are sent as written.

## Fields

| Placeholder | Meaning |
|---|---|
| `${adapter}` | Adapter name (e.g. `qq`, `sandbox`) |
| `${endpoint}` | Endpoint id of the sending account |
| `${endpointId}` | Account instance name (e.g. an ICQQ uin); only when replying to an incoming message |
| `${kind}` / `${conversationId}` | Conversation kind (`private` / `group` / `channel`) and id |
| `${sender.id}` / `${sender.name}` / `${sender.roles}` | The person this send answers (see "Subject" below); absent for scheduled and cross-conversation sends |
| `${content}` | Plain text of the incoming message |
| `${segments[0].type}` … | Structured segments of the incoming message |
| `${messageId}` / `${timestamp}` / `${mentioned}` | Incoming message id, arrival time (ms), whether the bot was @mentioned |
| `${prefix}` | Command prefix of the sending account; empty when it has none |
| `${menu}` | Menu entry of the sending account: prefix + menu keyword (root `menuKeyword`, default `菜单` / `menu`); left as written when `menuKeyword: false` turns the menu off |
| `${command.<path>}` | How **the sending plugin's own** command is typed on that account (prefix and `commandNamespace` included) |

### Subject: `sender`

`sender` is "the person this send answers":

- when replying to a message, its author;
- for a send triggered by an event without an incoming message (someone joined), the subject of the event, which the sending plugin passes to the outbound chain as `incoming.sender`. group-suite's welcome passes the new member this way, so welcome text uses `${sender.name}` / `${sender.id}`.

```ts
await this.use(outboundMessageToken).send({
  requester: this.owner.id,
  conversation: notice.conversation,
  content: 'Welcome ${sender.name}! Send ${menu} to see what I can do',
  incoming: { sender: { id: member.id, name: member.name || member.id }, content: '', timestamp: notice.timestamp },
});
```

### Writing `${command.*}`

- Keys are the command's static path segments: `commands/checkin` → `${command.checkin}`, `commands/group/kick` → `${command.group.kick}`; parameter directories (`[name]` …) are not segments.
- Write `-` as `_`: `commands/stats-rank` → `${command.stats_rank}` (plugin-local names never contain `_`, so this cannot collide). A segment that starts with a digit cannot be written as a path and is not offered.
- Only the sending plugin's own commands are listed (at most 256); other plugins' commands, commands of a plugin switched off in that conversation and unknown paths stay as written.
- A command that has subcommands is reachable only through them; non-leaf paths such as `${command}` or `${command.group}` stay as written.

## Environment references in configuration files

Configuration strings are environment-expanded first: `${NAME}` (letters, digits and underscores only) is replaced by the environment variable **when the configuration loads**, and by an empty string when it is unset. Dotted paths (`${sender.name}`, `${command.checkin}`) are not affected, but single names such as `${menu}`, `${prefix}` or `${content}` are taken as environment references.

To use those fields in a configuration file (including values written by the in-chat `feature set`), write `${menu:-${menu}}` / `${prefix:-${prefix}}` for now: with the variable unset this expands to exactly `${menu}`, which the outbound template then fills. Plugin code and taught answers stored in the database are not environment-expanded; write `${menu}` there.

## See also

- [group-suite welcome and taught answers](https://github.com/zhinjs/zhin/blob/main/plugins/utils/group-suite/README.md)
- [Group welcome](../solutions/group-welcome.md)
