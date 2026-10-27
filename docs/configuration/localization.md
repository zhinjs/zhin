# 语言与本地化

Zhin 支持 `zh-CN`（简体中文）和 `en`（英文），默认简体中文。项目语言、个人语言和 Console 界面语言分别设置；语言不会改变时区、权限或投递目标。

## 设置项目语言

在 `zhin.config.yml` 的根级设置：

```yaml
configVersion: 2
locale: en
```

新项目可在创建向导中选择语言，也可显式传入：

```sh
pnpm create zhin-app my-bot --locale en
zhin setup --locale en
```

`-y` 没有指定语言时仍使用中文。已有项目运行 `zhin setup` 而未指定语言时保留项目设置。时区仍由对应任务、插件或项目的时区配置决定，不会根据语言猜测所在地。

## 设置个人语言

在应用 Root 挂载了指令能力的 Bot 中发送 `language en` 或 `language zh-CN`，前面加当前 Bot 的实际指令前缀。例如前缀为 `/` 时发送 `/language en`；空前缀时直接发送 `language en`。仅在子插件挂载指令能力不会注册这个 Root 指令。

个人设置需要 SQLite、MySQL 或 PostgreSQL 持久存储。没有这些存储时项目语言仍有效，个人切换会明确说明不可用，不会临时保存并假装持久化成功。

个人语言优先于项目语言，同一 Bot 账号的私聊、群聊、频道共享此偏好；不同平台、Bot 账号和发送者相互隔离。因此同一群中的两个人可以各自收到中英文反馈。

一次确认、补问、点歌选择或菜单翻页开始后，语言固定到流程结束。即使在另一会话修改偏好，原流程的提示和可接受输入也保持一致；下一次新操作使用新语言。中文确认/取消流程只接受对应中文文本，英文流程只接受对应英文文本；合法按钮回调与序号仍按原流程处理。`language` 不会绕过已经在等待回答的交互。

默认菜单入口随语言切换为 `菜单` 或 `menu`。显式配置的菜单关键词、自定义提示和第三方原文保留作者设置。

## 后台通知与 Console

聊天创建的提醒、订阅和计划任务记录创建时的语言；之后更改个人偏好不改写既有任务。Console 管理员任务使用创建时的项目语言。旧任务没有语言字段时继续中文，不根据当前管理员或项目语言重新推断。

Console 在浏览器中独立保存界面语言，默认中文。切换只影响界面、配置标签和管理反馈，不改变任务的通知语言、配置 key、枚举存储值或投递身份。第三方插件没有提供翻译时显示原文；用户输入、文档正文、日志和已生成报告不会自动翻译。

脚手架生成的 README、Agent 规则和示例业务文案采用创建时选择的语言，之后是项目自己的源码。个人语言切换不会改写这些文件；自定义命令需要按下文从 `context.locale` 选择文案。

提醒支持有限英文时间规则，如 `in 10 minutes`、`tomorrow at 09:00`，对应中文规则与同一套时区、夏令时、期限校验。它不是任意自然语言解析器，解析不明确时仍会补问。

## AI 生成内容

AI 生成的正文优先遵从用户明确要求的回复语言，否则跟随用户原始输入的语言。只有两者都不明确时，才使用每轮 `[Turn context]` 中的 `Reply language fallback: zh-CN` 或 `en`，其值来自可信的个人偏好／项目语言。进度摘要和步数用尽后的总结遵循同样的规则；不会把框架追加的英文系统通知当作用户的语言。语言信息放在本轮动态上下文中，不按用户重写稳定的系统提示前缀。

这不是为每段模型正文保存中英文两个版本，也不会追加一次模型调用来翻译成品。模型生成内容保持原样；语言指令能明确要求输出语言，但不能替代真实模型的遵循性验证。菜单、审批选项、错误和生成失败的兜底消息是框架文案，仍按已设置的语言显示。插件的静态 Prompt Section 应尊重上述用户语言优先级，不应强制覆盖用户要求；它目前没有独立的 `contentI18n` 正文插槽。

## 插件如何接入

从当前操作读取语言，不保存进程级的“当前语言”。命令上下文和入站 Message 提供 `locale`；Agent 工具从执行上下文读取，不能使用模型参数覆盖可信语言。

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

`formatCommand()` 使用当前 snapshot 的命令索引、实例命名空间和实际前缀。上例的 `status` 必须是同一插件实际注册的命令；可传入目标 owner 引用其他实例。无法确定调用环境或找不到命令时返回 `undefined`，不要自行补 `/` 或拼出不存在的命令。Message 也提供同一方法，供入站中间件生成指引。

目录命令保留稳定身份。需要英文入口时显式声明别名，并指定英文展示使用哪一个：

```ts
alias: ['earthquake subscribe'],
preferredAliasI18n: { en: 'earthquake subscribe' },
```

首选别名必须实际出现在 `alias` 中。菜单、help 和 `formatCommand()` 复用同一索引，不会把翻译后的文字误当作可执行路径。

`createMessages()` 要求每个 key 同时提供两种语言，且占位符名称一致。替换只执行一次；用户内容中的 `{name}` 不会再次展开。结果是普通文本，HTML 转义继续由 JSX/渲染器负责。

配置 Schema 可声明显示翻译：

```ts
Schema.string().option(['text', 'image'])
  .description('显示方式')
  .i18n({ en: {
    description: 'Display format',
    enumLabels: { text: 'Text', image: 'Image' },
  } });
```

生成的 JSON Schema 使用 `x-i18n`；`enumLabels` 按实际枚举值的字符串形式索引。标签不参与校验和保存。外部严格 JSON Schema 校验器需声明支持这一显示注解，不能关闭全部严格校验来绕过它。

平台协议必须立即返回、尚未进入普通消息分发的默认回复，可在已经验签的 `Endpoint` 中调用 `await this.resolveLocale(senderId)`。它复用同一份个人偏好与项目语言，以当前 Endpoint 身份查询；候选或已退役 Endpoint 返回 `undefined`，不会读取用户状态。协议适配器保留本次查询结果，不能从请求参数或平台资料猜测语言。普通消息继续使用 `Message.locale`，无需再次查询。

插件业务验证可为检查提供 `titleI18n`、`effectsI18n`，为结果提供 `summaryI18n`、`evidenceI18n`，键为 `zh-CN` / `en`。副作用和证据译文须与原数组逐项对应且非空，不能用空译文隐藏条目。Console 只选择展示语言；审批仍绑定原检查 ID、运行代和包含完整翻译定义的修订号。
