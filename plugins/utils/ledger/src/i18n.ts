import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "actor": {
    "zh-CN": "记账需要在真实会话中由具体用户发送",
    "en": "Ledger commands require a real user in a conversation."
  },
  "usage": {
    "zh-CN": "格式：<类别> <金额> [备注]，例如：午饭 18.5 和同事",
    "en": "Format: <category> <amount> [note], for example: Lunch 18.5 With colleagues"
  },
  "order": {
    "zh-CN": "类别要写在金额前面。{usage}",
    "en": "Put the category before the amount. {usage}"
  },
  "amountError": {
    "zh-CN": "{reason}。{usage}",
    "en": "{reason} {usage}"
  },
  "categoryNumber": {
    "zh-CN": "类别不能是数字。{usage}",
    "en": "The category cannot be a number. {usage}"
  },
  "categoryLimit": {
    "zh-CN": "类别最多 {max} 个字",
    "en": "Category limit: {max} characters."
  },
  "noteLimit": {
    "zh-CN": "备注最多 {max} 个字",
    "en": "Note limit: {max} characters."
  },
  "negative": {
    "zh-CN": "金额不能为负数",
    "en": "Amount cannot be negative."
  },
  "amountFormat": {
    "zh-CN": "金额格式不正确，请写成 18 或 18.50（最多两位小数）",
    "en": "Use an amount such as 18 or 18.50, with at most two decimal places."
  },
  "zero": {
    "zh-CN": "金额必须大于 0",
    "en": "Amount must be greater than zero."
  },
  "amountMax": {
    "zh-CN": "单笔金额不能超过 ¥1000000.00",
    "en": "A single entry cannot exceed ¥1000000.00."
  },
  "period.today": {
    "zh-CN": "今日",
    "en": "Today"
  },
  "period.week": {
    "zh-CN": "本周",
    "en": "This week"
  },
  "period.month": {
    "zh-CN": "本月",
    "en": "This month"
  },
  "period.all": {
    "zh-CN": "全部",
    "en": "All time"
  },
  "allRecords": {
    "zh-CN": "全部记录",
    "en": "All records"
  },
  "periodInput": {
    "zh-CN": "时间范围只能是：今日、本周、本月、全部",
    "en": "Choose a period: today, week, month, all."
  },
  "actionInput": {
    "zh-CN": "操作只能是：开启、关闭、状态",
    "en": "Choose an action: on, off, status."
  },
  "added": {
    "zh-CN": "✅ 已记账 #{seq} · {category} {amount}{note}",
    "en": "✅ Recorded #{seq} · {category} {amount}{note}"
  },
  "notFound": {
    "zh-CN": "没有找到你的账目 #{seq}（只能删除自己的记账，请查看账单编号）",
    "en": "Your entry #{seq} was not found. You can only delete your own entries; check the entry list for its ID."
  },
  "deleted": {
    "zh-CN": "🗑️ 已删除 #{seq} · {category} {amount}",
    "en": "🗑️ Deleted #{seq} · {category} {amount}"
  },
  "spending": {
    "zh-CN": "{period}消费",
    "en": "{period} spending"
  },
  "statistics": {
    "zh-CN": "分类统计",
    "en": "Category statistics"
  },
  "entryList": {
    "zh-CN": "{period}账单",
    "en": "{period} entries"
  },
  "privateSent": {
    "zh-CN": "🔒 {title}已私信发送给你",
    "en": "🔒 {title} was sent to you privately."
  },
  "privateFallback": {
    "zh-CN": "{text}\n（群聊中金额已隐藏，私聊我可查看完整金额）",
    "en": "{text}\n(Amounts are hidden in public chats. Message me privately to view them.)"
  },
  "reportEnabled": {
    "zh-CN": "记账日报已开启：每天 {time}（{timezone}）私信发送当天消费",
    "en": "Daily reports are enabled: today’s spending is sent privately at {time} ({timezone})."
  },
  "reportDisabled": {
    "zh-CN": "记账日报未开启。",
    "en": "Daily reports are disabled."
  },
  "reportOff": {
    "zh-CN": "已关闭记账日报",
    "en": "Daily reports disabled."
  },
  "noPrivate": {
    "zh-CN": "当前环境不支持主动私信，无法开启记账日报",
    "en": "This environment cannot send proactive private messages; daily reports cannot be enabled."
  },
  "reportOn": {
    "zh-CN": "已开启记账日报：每天 {time}（{timezone}）私信发送当天消费。",
    "en": "Daily reports enabled: today’s spending is sent privately at {time} ({timezone})."
  },
  "cannotPrivate": {
    "zh-CN": "无法私信你，请先私聊我后再开启记账日报。",
    "en": "I could not message you privately. Message me privately before enabling daily reports."
  },
  "reportOnPrivate": {
    "zh-CN": "🔒 已开启记账日报，确认消息已私信发送给你",
    "en": "🔒 Daily reports enabled; confirmation was sent to you privately."
  },
  "report": {
    "zh-CN": "🌙 记账日报\n{text}",
    "en": "🌙 Daily expense report\n{text}"
  },
  "commandHint": {
    "zh-CN": "发送「{command}」。",
    "en": "Send \"{command}\"."
  },
  "emptySummary": {
    "zh-CN": "📒 {period}还没有记账（{range}）",
    "en": "📒 {period}: no expenses recorded ({range})."
  },
  "summaryHeader": {
    "zh-CN": "📒 {period}消费（{range}）",
    "en": "📒 {period} spending ({range})"
  },
  "total": {
    "zh-CN": "合计 {amount} · {count} 笔",
    "en": "Total {amount} · {count} entries"
  },
  "categoryFull": {
    "zh-CN": "· {category} {amount}（{count} 笔，{share}%）",
    "en": "· {category} {amount} ({count} entries, {share}%)"
  },
  "categoryMasked": {
    "zh-CN": "· {category} {amount}（{count} 笔）",
    "en": "· {category} {amount} ({count} entries)"
  },
  "emptyStats": {
    "zh-CN": "📊 {period}没有可统计的记账（{range}）",
    "en": "📊 {period}: no entries to analyze ({range})."
  },
  "statsHeader": {
    "zh-CN": "📊 分类统计 · {period}（{range}）",
    "en": "📊 Category statistics · {period} ({range})"
  },
  "statsFull": {
    "zh-CN": "· {category}：合计 {amount}，{count} 笔，平均 {average}，最大 {max}，占比 {share}%",
    "en": "· {category}: total {amount}, {count} entries, average {average}, largest {max}, share {share}%"
  },
  "statsMasked": {
    "zh-CN": "· {category}：{count} 笔，金额已隐藏",
    "en": "· {category}: {count} entries, amounts hidden"
  },
  "categoryCount": {
    "zh-CN": "共 {count} 个类别",
    "en": "{count} categories"
  },
  "categoryCountTotal": {
    "zh-CN": "共 {count} 个类别 · 合计 {amount}",
    "en": "{count} categories · total {amount}"
  },
  "emptyList": {
    "zh-CN": "🧾 {period}没有账目（{range}）",
    "en": "🧾 {period}: no entries ({range})."
  },
  "listHeader": {
    "zh-CN": "🧾 {period}账单（{range}）",
    "en": "🧾 {period} entries ({range})"
  },
  "more": {
    "zh-CN": "……另有 {count} 笔未显示",
    "en": "… {count} more entries not shown"
  }
});
