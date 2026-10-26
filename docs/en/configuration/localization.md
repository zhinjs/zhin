# Language and localization

Zhin supports `zh-CN` (Simplified Chinese) and `en` (English). Chinese remains the default. Project, personal, and Console languages are independent of time zones, permissions, and delivery destinations.

## Project language

Set the root field in `zhin.config.yml`:

```yaml
configVersion: 2
locale: en
```

Choose a language in the project wizard or pass it explicitly:

```sh
pnpm create zhin-app my-bot --locale en
zhin setup --locale en
```

Without an explicit language, `-y` keeps the Chinese default. Running setup on an existing project without `--locale` preserves its language. Configure time zones separately; English does not imply a location or time zone.

## Personal language

With the Command Feature mounted on the application Root, send `language en` or `language zh-CN` using the bot's actual command prefix. With `/`, send `/language en`; with an empty prefix, send `language en`. Mounting the feature only in a child plugin does not register this Root command.

Personal preferences require SQLite, MySQL, or PostgreSQL. Project language still works without SQL. Personal switching reports unavailable storage rather than silently saving a temporary preference.

A personal preference takes priority, including in groups and channels. It is shared across conversations with the same bot account and sender, but isolated across platforms and bot accounts. Two members in one group can therefore receive different languages.

Confirmations, follow-up questions, music selections, and menu pagination keep their starting language until completion. A preference change affects new operations. Chinese flows accept their Chinese confirmation/cancellation text; English flows accept the English equivalent. Valid button actions and numeric choices retain their existing scope. The language command does not bypass a pending interaction.

The default menu entry is `menu` in English and `菜单` in Chinese. Explicitly configured menu keywords and custom labels remain unchanged.

## Notifications and Console

Chat-created reminders, subscriptions, and scheduled tasks capture the creator's language. Console administrator tasks capture the project language. Later preference changes do not rewrite existing notifications. Legacy tasks without a language retain Chinese.

Console stores its independent language in the browser and defaults to Chinese. Changing it affects UI labels, schema descriptions, and management feedback; it does not change saved configuration keys, enum values, task language, or delivery identities. Untranslated third-party text, user content, logs, and previously generated reports retain their original text.

Reminders accept finite English time patterns such as `in 10 minutes` and `tomorrow at 09:00`, with the same time-zone, daylight-saving, and deadline validation as their Chinese equivalents. Ambiguous input still requires clarification.

## Plugin integration

Read `context.locale` in commands and Agent tools, or `message.locale` for inbound messages. Do not keep a mutable process-wide language, or let model tool arguments override the trusted locale.

```ts
import { defineCommand } from 'zhin.js/command';
import { createMessages } from 'zhin.js/i18n';

const t = createMessages({
  done: { 'zh-CN': '完成；查看详情：{command}', en: 'Done. View details: {command}' },
  unavailable: { 'zh-CN': '已完成。', en: 'Done.' },
});

export default defineCommand({
  description: '完成任务',
  descriptionI18n: { en: 'Complete the task' },
  execute(context) {
    const command = context.formatCommand('status');
    return command === undefined
      ? t(context.locale, 'unavailable')
      : t(context.locale, 'done', { command });
  },
});
```

`status` must be a real command in the plugin. `formatCommand(localPath, owner?)` resolves the current snapshot's command, namespace, and actual prefix. It returns `undefined` when the environment or command is unknown; do not invent a slash prefix or a command path. Inbound Message exposes the same method.

For a localized command entry, declare an actual alias and select it for display:

```ts
alias: ['earthquake subscribe'],
preferredAliasI18n: { en: 'earthquake subscribe' },
```

The preferred alias must exist in `alias`. Menus, help, and command references use the same index; translation does not create a second routing system.

Every `createMessages()` key requires both languages with matching placeholder names. Substitution is single-pass, and returns plain text; JSX/renderers remain responsible for HTML escaping.

Translate schema labels without changing validation or persisted values:

```ts
Schema.string().option(['text', 'image'])
  .description('显示方式')
  .i18n({ en: {
    description: 'Display format',
    enumLabels: { text: 'Text', image: 'Image' },
  } });
```

JSON Schema exports this as `x-i18n`. Enum labels are keyed by `String(value)`. External strict schema validators must register this display annotation; do not disable strict validation globally.
