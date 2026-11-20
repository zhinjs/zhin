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

The personal language also sets the language of AI replies (see [AI-generated content](#ai-generated-content)): after `/language en`, the AI answers in English even when asked in Chinese, unless the current message explicitly asks for another language (such as "answer in Chinese"). Users who never set a personal language are unaffected.

Confirmations, follow-up questions, music selections, and menu pagination keep their starting language until completion. A preference change affects new operations. Confirmation and cancellation replies are accepted in Chinese or English whatever the flow's language (`yes` in a Chinese flow and `取消` in an English one both count). Valid button actions and numeric choices retain their existing scope. The language command does not bypass a pending interaction.

The default menu entry is `menu` in English and `菜单` in Chinese. Explicitly configured menu keywords and custom labels remain unchanged.

## Notifications and Console

Chat-created reminders, subscriptions, and scheduled tasks capture the creator's language. Console administrator tasks capture the project language. Later preference changes do not rewrite existing notifications. Legacy tasks without a language retain Chinese.

Console stores its independent language in the browser and defaults to Chinese. Changing it affects UI labels, schema descriptions, and management feedback; it does not change saved configuration keys, enum values, task language, or delivery identities. Untranslated third-party text, user content, logs, and previously generated reports retain their original text.

Generated README files, Agent instructions and example business messages use the language selected at creation. They then belong to the project source. Personal language changes do not rewrite these files; custom commands should select text with `context.locale` as shown below.

Reminders accept finite English time patterns such as `in 10 minutes` and `tomorrow at 09:00`, with the same time-zone, daylight-saving, and deadline validation as their Chinese equivalents. Ambiguous input still requires clarification.

## AI-generated content

The language of AI-generated text is chosen in this order:

1. A reply language the user explicitly asks for. When the user set a personal language with `/language`, only a request in the **current message** overrides that setting.
2. The personal language the user set with `/language`. That turn's `[Turn context]` reads `Reply language (set by the user with /language): en.`, followed by a note that the setting applies even when the user writes in another language and that a language in `[User profile]` is only a reference and never overrides it.
3. The language of the user's actual message (an English framework notice does not determine the user's language).
4. If none of these is clear, `Reply language fallback: zh-CN` or `en` (the project language, Chinese by default), then SOUL.md.

Users who never set a personal language keep the previous behaviour: an explicit request first, then the language of their message, then the project language as the fallback (the line still reads `Reply language fallback: …`). Only a turn that answers one present sender uses that sender's setting; merged multi-sender group turns, live danmaku windows and ambient turns where the bot chimes in on its own keep the fallback, so members of one group do not affect each other. Chat-created reminders and scheduled tasks keep the language captured when they were created.

Progress and exhausted-turn summaries follow the same rule and wording. The value stays in the dynamic turn context rather than rewriting the stable system-prompt prefix per user. The `language` field of the `user_profile` tool is only a reference: the model should not change the reply language for the user, but suggest the language command (such as `/language en`) instead.

This does not store two language versions of every generated reply or add a model call to translate the result. Model-generated content remains unchanged. Explicit instructions specify the language; actual model compliance still requires provider validation. Framework menus, approval choices, errors and fixed generation-failure messages still use the configured language. A plugin's static Prompt Section should respect the user-language priority above instead of overriding explicit requests. It currently has no separate `contentI18n` body slot.

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

`x-i18n` holds, per Console interface locale (`zh-CN` / `en`), a field's `title` (the label shown in the form), `description` and `enumLabels`. Without a title the Console shows the schema key (such as `teachCooldownMs`), so plugins meant for administrators should give titles in both languages:

```ts
teachCooldownMs: Schema.number().default(10_000)
  .description('同一成员两次教学之间的最短间隔')
  .i18n({
    'zh-CN': { title: '教学冷却时间' },
    en: { title: 'Teach cooldown', description: 'Minimum interval between two teach commands from the same member.' },
  }),
```

In a hand-written `schema.json`, put the same `x-i18n` object on the property. The Console picks each text independently in this order: the translation for the current interface locale → the schema's own `title` / `description` → the `en` translation → the field key (titles only). Plugins without `x-i18n` therefore look the same as before, and a Chinese `description` with only an `en` translation still shows Chinese in the Chinese interface. The field key stays beside the title as secondary text so it can be matched with the configuration file. Translations are display-only: keys, defaults, validation and stored values do not change.

Plugin display names can be translated too. Declare `displayNameI18n` in `definePlugin({ metadata })` or `package.json#zhin.metadata` (in one of them only, like `displayName`):

```ts
metadata: {
  displayName: 'Repeater',
  displayNameI18n: { 'zh-CN': '复读机', en: 'Repeater' },
},
```

The Console plugin list, feature matrix and feature pages choose the name by interface locale, falling back from the current locale → `en` → `displayName` → the instance key. Only the `zh-CN` and `en` keys are accepted, and each value must be a non-empty string.

Plugins published to npm should declare it in `package.json#zhin.metadata`: the plugin market only reads the published `package.json`, never `definePlugin()` code. The market also reads `descriptionI18n` (localized description) and `category` from the same place; see [Plugin delivery · Marketplace metadata](../authoring/plugin-delivery.md#marketplace-metadata).

For immediate protocol responses before normal message dispatch, a signature-verified `Endpoint` may call `await this.resolveLocale(senderId)`. This uses the same personal preferences and project language with the current Endpoint identity. Candidate or retired endpoints return `undefined` without reading user state. Keep the resolved language for that response; do not infer it from request parameters or platform profiles. Normal messages continue to use `Message.locale` without a second lookup.

Plugin business checks may provide `titleI18n` and `effectsI18n`; results may provide `summaryI18n` and `evidenceI18n`, keyed by `zh-CN` / `en`. Translated effects and evidence must match the original arrays item for item with nonempty text. Empty translations cannot hide entries. Console only selects the displayed language; approval remains bound to the original check ID, generation and revision covering the complete translation definitions.
