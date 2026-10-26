import { createMessages } from 'zhin.js/i18n';

export const reminderMessages = createMessages({
  "created": {
    "zh-CN": "已创建提醒",
    "en": "Reminder created"
  },
  "createdPeriodic": {
    "zh-CN": "已创建周期提醒",
    "en": "Recurring reminder created"
  },
  "empty": {
    "zh-CN": "你在此会话没有提醒任务",
    "en": "You have no reminders in this conversation"
  },
  "cancelled": {
    "zh-CN": "已取消提醒；已经开始的投递无法撤销",
    "en": "Reminder cancelled; delivery already in progress cannot be recalled"
  },
  "notFound": {
    "zh-CN": "未找到你在此会话的提醒",
    "en": "No reminder belonging to you was found in this conversation"
  },
  "actorRequired": {
    "zh-CN": "提醒指令需要真实会话和发送者",
    "en": "Reminder commands require a real conversation and sender"
  },
  "contentInvalid": {
    "zh-CN": "提醒内容须为 1–500 个字符",
    "en": "Reminder text must contain 1–500 characters"
  },
  "futureRequired": {
    "zh-CN": "提醒时间须在未来一年内",
    "en": "The reminder must be scheduled within the next year"
  },
  "intervalInvalid": {
    "zh-CN": "周期须为 60 秒至一年",
    "en": "The interval must be between 60 seconds and one year"
  },
  "instanceLimit": {
    "zh-CN": "此插件实例的提醒数量已达上限，请先取消任务",
    "en": "This plugin instance has reached its reminder limit; cancel a task first"
  },
  "actorLimit": {
    "zh-CN": "你在此会话的提醒数量已达上限，请先取消任务",
    "en": "You have reached the reminder limit for this conversation; cancel a task first"
  },
  "userCancelled": {
    "zh-CN": "用户取消；已经开始的投递无法撤销",
    "en": "Cancelled by the user; delivery already in progress cannot be recalled"
  },
  "skipped": {
    "zh-CN": "已跳过错过的周期轮次",
    "en": "Missed recurring runs were skipped"
  },
  "unknown": {
    "zh-CN": "投递中或未确认；不会自动重试",
    "en": "Delivery is in progress or unconfirmed; it will not be retried automatically"
  },
  "unconfirmed": {
    "zh-CN": "平台未返回确认的消息 ID；不会自动重试",
    "en": "The platform did not return a confirmed message ID; delivery will not be retried automatically"
  },
  "notification": {
    "zh-CN": "⏰ 提醒：{text}",
    "en": "⏰ Reminder: {text}"
  },
  "delivered": {
    "zh-CN": "已确认投递",
    "en": "Delivery confirmed"
  },
  "deliveryFailed": {
    "zh-CN": "投递失败：{code}；任务已停止",
    "en": "Delivery failed: {code}; the task has stopped"
  },
  "checkUnconfirmed": {
    "zh-CN": "投递结果未确认；请核对目标会话后取消或重新创建",
    "en": "Delivery is unconfirmed; check the target conversation before cancelling or creating a new reminder"
  },
  "pending": {
    "zh-CN": "待触发",
    "en": "Scheduled"
  },
  "unknownStatus": {
    "zh-CN": "投递中或未确认",
    "en": "In progress or unconfirmed"
  },
  "deliveredStatus": {
    "zh-CN": "已完成",
    "en": "Completed"
  },
  "failedStatus": {
    "zh-CN": "投递失败",
    "en": "Delivery failed"
  },
  "cancelledStatus": {
    "zh-CN": "已取消",
    "en": "Cancelled"
  },
  "every": {
    "zh-CN": "每 {seconds} 秒",
    "en": "Every {seconds} seconds"
  },
  "storageLimit": {
    "zh-CN": "提醒存储达到大小上限，请先取消旧任务",
    "en": "Reminder storage has reached its size limit; cancel old tasks first"
  },
  "needsChat": {
    "zh-CN": "请在真实聊天会话中使用此指令；需要发送者身份和交互能力，未创建提醒。",
    "en": "Use this command in a real chat with a sender identity and interaction support. No reminder was created."
  },
  "flowTimeout": {
    "zh-CN": "提醒输入超时，未创建提醒。",
    "en": "Reminder input timed out. No reminder was created."
  },
  "restartCommand": {
    "zh-CN": "请重新执行 {command}。",
    "en": "Run {command} again."
  },
  "restart": {
    "zh-CN": "请重新发起提醒创建流程。",
    "en": "Start the reminder creation flow again."
  },
  "answerTip": {
    "zh-CN": "直接回复内容，不加命令前缀；输入“取消”可退出。",
    "en": "Reply directly without a command prefix. Enter \"cancel\" to exit."
  },
  "askWhen": {
    "zh-CN": "什么时候提醒你？",
    "en": "When should I remind you?"
  },
  "whenHelp": {
    "zh-CN": "按 {timezone} 解析，例如“10分钟后”或“明天上午九点”；也可使用带 offset 的 ISO 时间。",
    "en": "Parsed in {timezone}. Use \"in 10 minutes\", \"tomorrow at 09:00\", or an ISO timestamp with an explicit offset."
  },
  "askBody": {
    "zh-CN": "提醒你做什么？",
    "en": "What should I remind you about?"
  },
  "bodyHelp": {
    "zh-CN": "请输入纯文字提醒正文（1–500 字）。",
    "en": "Enter plain reminder text (1–500 characters)."
  },
  "bodyLimit": {
    "zh-CN": "提醒正文须为 1–500 个字符。",
    "en": "Reminder text must contain 1–500 characters."
  },
  "bodyCommand": {
    "zh-CN": "当前正在补全提醒；请直接回复正文，或先取消后重新发指令。",
    "en": "A reminder is being completed. Reply with the reminder text, or cancel before starting another command."
  },
  "preview": {
    "zh-CN": "时间：{time}\n原会话：{scene}\n账号：{account}\n正文（原样显示）：\n{text}\n\n请等待下一条确认提示，再输入“确认”创建；不会更换目标会话。",
    "en": "Time: {time}\nOriginal conversation: {scene}\nAccount: {account}\nText (shown verbatim):\n{text}\n\nWait for the next confirmation prompt, then enter \"confirm\" to create. The target conversation will remain unchanged."
  },
  "parent": {
    "zh-CN": "父容器",
    "en": "Parent"
  },
  "checkCommand": {
    "zh-CN": "若确认后未收到创建结果，请先在原会话用 {command} 核对，不要直接重复创建。",
    "en": "If the creation result is missing after confirmation, use {command} in the original conversation to check before creating another reminder."
  },
  "checkNoCommand": {
    "zh-CN": "若确认后未收到创建结果，请先核对现有提醒，不要直接重复创建。",
    "en": "If the creation result is missing after confirmation, check existing reminders before creating another one."
  },
  "askConfirm": {
    "zh-CN": "确认创建这条提醒？",
    "en": "Create this reminder?"
  },
  "confirmHelp": {
    "zh-CN": "请核对上一条预览的时间、时区、正文和原会话；仅输入“确认”才创建。",
    "en": "Check the time, timezone, text and original conversation in the preview. Enter \"confirm\" to create."
  },
  "confirmInvalid": {
    "zh-CN": "未创建提醒。请明确输入“确认”，或输入“取消”退出。",
    "en": "No reminder was created. Enter \"confirm\", or enter \"cancel\" to exit."
  },
  "expired": {
    "zh-CN": "提醒时间已过，未创建提醒。请选择未来时间；不会自动顺延。",
    "en": "The reminder time has passed. No reminder was created. Choose a future time; it will not be postponed automatically."
  },
  "personalCreated": {
    "zh-CN": "已创建个人提醒",
    "en": "Personal reminder created"
  },
  "flowCancelled": {
    "zh-CN": "已取消，未创建提醒。",
    "en": "Cancelled. No reminder was created."
  },
  "notCreated": {
    "zh-CN": "未创建提醒：{error}",
    "en": "No reminder was created: {error}"
  },
  "previewFailed": {
    "zh-CN": "提示消息未能确认送达，未创建提醒；请核对会话后重新执行，不会自动重发。",
    "en": "Delivery of the prompt was not confirmed. No reminder was created; check the conversation before trying again. The prompt will not be resent automatically."
  },
  "absoluteInvalid": {
    "zh-CN": "绝对时间须为有效的 ISO 时间并包含时区 offset",
    "en": "Use a valid ISO timestamp with an explicit timezone offset"
  },
  "timeLength": {
    "zh-CN": "提醒时间须为不超过 200 个字符的文字",
    "en": "Reminder time must be text of at most 200 characters"
  },
  "timeOneLine": {
    "zh-CN": "请在一行内输入提醒时间",
    "en": "Enter the reminder time on one line"
  },
  "timeAbsolute": {
    "zh-CN": "绝对时间无效，请使用带 Z 或 ±hh:mm 的 ISO 时间，例如 2026-10-20T09:00:00+08:00",
    "en": "Use a valid ISO timestamp with Z or an explicit ±hh:mm offset, such as 2027-01-01T09:00:00+08:00"
  },
  "timeRange": {
    "zh-CN": "提醒时间不能超过当前时间的 365 天后",
    "en": "The reminder cannot be more than 365 days in the future"
  },
  "timeFuture": {
    "zh-CN": "提醒时间须在当前时间至少 1 秒后；今天已过的时间不会自动改到明天，请重新指定日期",
    "en": "The reminder must be at least one second in the future. Past times are not postponed to tomorrow; choose a new date"
  },
  "timeInstant": {
    "zh-CN": "当前时间或提醒时间无效",
    "en": "The current time or reminder time is invalid"
  },
  "timeZone": {
    "zh-CN": "提醒时区无效，请配置有效的 IANA 时区，例如 Asia/Shanghai",
    "en": "Configure a valid IANA timezone, such as Asia/Shanghai"
  },
  "timeDateRange": {
    "zh-CN": "提醒日期超出支持范围",
    "en": "The reminder date is outside the supported range"
  },
  "timeGap": {
    "zh-CN": "这个本地时间因时区或夏令时切换而不存在，请改用明确日期并带 offset 的 ISO 时间",
    "en": "This local time does not exist because of a timezone transition. Use an ISO timestamp with an explicit date and offset"
  },
  "timeFold": {
    "zh-CN": "这个本地时间因夏令时切换出现两次，请使用带明确 offset 的 ISO 时间选择其中一次",
    "en": "This local time occurs twice because of daylight saving time. Use an ISO timestamp with an explicit offset to select one occurrence"
  },
  "timeClock": {
    "zh-CN": "时间须写为 09:30、九点、九点半或九点三十分；请同时指定今天、明天或后天",
    "en": "Specify today, tomorrow or the day after tomorrow with an explicit clock time"
  },
  "timeClockRange": {
    "zh-CN": "小时须为 0–23，分钟和秒须为 0–59",
    "en": "Hours must be 0–23; minutes and seconds must be 0–59"
  },
  "timePeriod": {
    "zh-CN": "时段与钟点不明确，请使用 24 小时制，例如 00:00 或 18:00",
    "en": "The clock time and period are ambiguous; use 24-hour time such as 00:00 or 18:00"
  },
  "timeMorning": {
    "zh-CN": "时段与钟点不明确，请使用 24 小时制，例如 00:00 或 12:00",
    "en": "The clock time and period are ambiguous; use 24-hour time such as 00:00 or 12:00"
  },
  "timeNoon": {
    "zh-CN": "中午的钟点不明确，请使用 24 小时制",
    "en": "The noon time is ambiguous; use 24-hour time"
  },
  "timeNumberRange": {
    "zh-CN": "时间数值过大，请使用一年以内的时间",
    "en": "The time value is too large; choose a time within one year"
  },
  "timeChineseNumber": {
    "zh-CN": "中文数字不明确，请改用阿拉伯数字",
    "en": "The Chinese number is ambiguous; use Arabic numerals"
  },
  "timeChineseInteger": {
    "zh-CN": "中文数字不明确，请写完整中文整数或改用阿拉伯数字",
    "en": "Use a complete Chinese integer or Arabic numerals"
  },
  "timeGrammar": {
    "zh-CN": "暂不支持这种时间表达，请使用“十分钟后”“明天九点半”或带时区 offset 的 ISO 时间；不支持每天、每周等日历周期",
    "en": "This time expression is not supported. Use \"in 10 minutes\", \"tomorrow at 09:00\", or an ISO timestamp with an explicit offset. Calendar recurrence is not supported."
  },
  "toolOrigin": {
    "zh-CN": "提醒工具只能在聊天会话中使用（不能用于 http/schedule 等来源）",
    "en": "Reminder tools require a chat conversation; HTTP and scheduled-agent origins are not supported."
  },
  "toolEndpoint": {
    "zh-CN": "无法确定当前会话所属的机器人账号",
    "en": "Could not identify the bot account for this conversation."
  },
  "toolSender": {
    "zh-CN": "提醒工具需要真实发送者",
    "en": "Reminder tools require a real sender."
  },
  "toolMode": {
    "zh-CN": "请在 after / at / every_seconds 中只选一种时间表达",
    "en": "Choose exactly one of after, at or every_seconds."
  },
  "toolEmpty": {
    "zh-CN": "当前会话没有提醒",
    "en": "There are no reminders in this conversation."
  },
  "toolCancelled": {
    "zh-CN": "已取消提醒 {id}",
    "en": "Reminder {id} cancelled."
  },
  "toolNotFound": {
    "zh-CN": "找不到提醒 {id}（或不属于你在当前会话的任务）",
    "en": "Reminder {id} was not found or does not belong to you in this conversation."
  },
  "durationInvalid": {
    "zh-CN": "延迟秒数无效",
    "en": "Invalid delay in seconds."
  },
  "durationFormat": {
    "zh-CN": "时长格式无效（示例：600、10m、2h、1d）",
    "en": "Invalid duration (examples: 600, 10m, 2h, 1d)."
  },
  "absoluteFormat": {
    "zh-CN": "绝对时间须为带 Z 或 ±hh:mm 的 ISO 时间，例如 2026-10-14T09:00:00+08:00",
    "en": "Use an ISO time with Z or an explicit ±hh:mm offset, such as 2026-10-14T09:00:00+08:00."
  },
  "instantInvalid": {
    "zh-CN": "提醒时间无效",
    "en": "Invalid reminder time."
  },
  "thread": {
    "zh-CN": "话题",
    "en": "Thread"
  },
  "serviceStopped": {
    "zh-CN": "提醒服务属于已停止的插件实例",
    "en": "This reminder service belongs to a stopped plugin instance"
  },
  "invalidState": {
    "zh-CN": "提醒持久状态格式无效，已停止投递",
    "en": "Reminder storage is invalid; delivery has been stopped"
  }
});
