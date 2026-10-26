import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "checkinRetry": {
    "zh-CN": "签到数据库尚未就绪，请稍后重试",
    "en": "The check-in database is not ready; try again later"
  },
  "checkinDb": {
    "zh-CN": "签到数据库尚未就绪",
    "en": "The check-in database is not ready"
  },
  "senderMissing": {
    "zh-CN": "无法获取用户信息",
    "en": "Could not identify the sender"
  },
  "checkinFailed": {
    "zh-CN": "签到失败，请重试",
    "en": "Check-in failed; try again"
  },
  "checkinDone": {
    "zh-CN": "签到成功！",
    "en": "Checked in!"
  },
  "checked": {
    "zh-CN": "今日已签到 ✓",
    "en": "Checked in today ✓"
  },
  "unchecked": {
    "zh-CN": "今日未签到",
    "en": "Not checked in today"
  },
  "checkinEmpty": {
    "zh-CN": "还没有人签到过哦～",
    "en": "No one has checked in yet"
  },
  "groupPoints": {
    "zh-CN": "本群积分排行",
    "en": "Group points leaderboard"
  },
  "channelPoints": {
    "zh-CN": "本频道积分排行",
    "en": "Channel points leaderboard"
  },
  "privatePoints": {
    "zh-CN": "当前私聊积分排行",
    "en": "Private conversation points leaderboard"
  },
  "alreadyChecked": {
    "zh-CN": "你今天已经签到过了哦～\n当前积分: {points}\n连续签到: {days} 天",
    "en": "Already checked in today\nPoints: {points}\nStreak: {days} days"
  },
  "basePoints": {
    "zh-CN": "基础积分: +{points}",
    "en": "Base points: +{points}"
  },
  "bonusPoints": {
    "zh-CN": "连续奖励: +{points} (连续{days}天)",
    "en": "Streak bonus: +{points} ({days} days)"
  },
  "earnedPoints": {
    "zh-CN": "本次获得: +{points}",
    "en": "Earned: +{points}"
  },
  "currentPoints": {
    "zh-CN": "当前积分: {points}",
    "en": "Points: {points}"
  },
  "checkinHint": {
    "zh-CN": "你还没有签到记录，发送「{command}」开始吧！",
    "en": "No check-ins yet. Send “{command}” to start."
  },
  "checkinHintNoHead": {
    "zh-CN": "你还没有签到记录，请使用签到入口开始",
    "en": "No check-ins yet. Use the check-in entry to start."
  },
  "pointsTitle": {
    "zh-CN": "{name} 的积分信息",
    "en": "Points for {name}"
  },
  "points": {
    "zh-CN": "积分: {points}",
    "en": "Points: {points}"
  },
  "checkinTotal": {
    "zh-CN": "累计签到: {days} 天",
    "en": "Check-ins: {days} days"
  },
  "checkinStreak": {
    "zh-CN": "连续签到: {days} 天",
    "en": "Streak: {days} days"
  },
  "checkinMax": {
    "zh-CN": "最长连续: {days} 天",
    "en": "Longest streak: {days} days"
  },
  "pointsRow": {
    "zh-CN": "{prefix} {name} — {points}分 ({days}天)",
    "en": "{prefix} {name} — {points} points ({days} days)"
  },
  "myRankFooter": {
    "zh-CN": "\n你的排名: 第{rank}名",
    "en": "\nYour rank: #{rank}"
  },
  "user": {
    "zh-CN": "用户",
    "en": "User"
  },
  "you": {
    "zh-CN": "你",
    "en": "You"
  },
  "teachRetry": {
    "zh-CN": "问答数据库尚未就绪，请稍后重试",
    "en": "The Q&A database is not ready; try again later"
  },
  "teachDb": {
    "zh-CN": "问答数据库尚未就绪",
    "en": "The Q&A database is not ready"
  },
  "regexDisabled": {
    "zh-CN": "管理员已禁用正则问答",
    "en": "Regex Q&A is disabled by the administrator"
  },
  "unsafeRegex": {
    "zh-CN": "该正则可能导致性能问题，请简化",
    "en": "This regex may cause performance problems; simplify it"
  },
  "teachEmpty": {
    "zh-CN": "还没有教过任何问答哦～",
    "en": "No Q&A entries yet"
  },
  "regex": {
    "zh-CN": "[正则]",
    "en": "[Regex]"
  },
  "exact": {
    "zh-CN": "[精确]",
    "en": "[Exact]"
  },
  "teachTitle": {
    "zh-CN": "本会话问答列表",
    "en": "Q&A in this conversation"
  },
  "questionRequired": {
    "zh-CN": "请提供要删除的问题",
    "en": "Provide the question to remove"
  },
  "regexUsage": {
    "zh-CN": "格式：正则 回答，或 正则|回答",
    "en": "Format: pattern answer, or pattern|answer"
  },
  "teachUsage": {
    "zh-CN": "格式：关键词 回答，或 问题|答案",
    "en": "Format: keyword answer, or question|answer"
  },
  "invalidRegex": {
    "zh-CN": "正则表达式不合法: {error}",
    "en": "Invalid regular expression: {error}"
  },
  "teachLimit": {
    "zh-CN": "该群问答数已达上限 ({limit})",
    "en": "This group has reached its Q&A limit ({limit})"
  },
  "teachUpdated": {
    "zh-CN": "已更新问答：「{question}」→「{answer}」",
    "en": "Q&A updated: “{question}” → “{answer}”"
  },
  "regexLearned": {
    "zh-CN": "学会了！匹配 /{question}/ 的消息我会回复「{answer}」",
    "en": "Learned! Messages matching /{question}/ receive “{answer}”"
  },
  "teachLearned": {
    "zh-CN": "学会了！发送「{question}」我会回复「{answer}」",
    "en": "Learned! Send “{question}” to receive “{answer}”"
  },
  "teachPage": {
    "zh-CN": "{header}\n{lines}\n第 {page}/{pages} 页 · 共 {count} 条",
    "en": "{header}\n{lines}\nPage {page}/{pages} · {count} entries"
  },
  "questionMissing": {
    "zh-CN": "没有找到问题「{question}」",
    "en": "Question “{question}” was not found"
  },
  "questionRemoved": {
    "zh-CN": "已忘记「{question}」的回答",
    "en": "Removed the answer to “{question}”"
  },
  "statsEmpty": {
    "zh-CN": "{title}\n暂无数据",
    "en": "{title}\nNo data"
  },
  "statsRow": {
    "zh-CN": "{prefix} {name} — {count}条",
    "en": "{prefix} {name} — {count} messages"
  },
  "statsFooter": {
    "zh-CN": "\n共 {people} 人, {messages} 条消息",
    "en": "\n{people} participants, {messages} messages"
  },
  "statsMyFooter": {
    "zh-CN": " | 你第{rank}名 ({count}条)",
    "en": " | Your rank: #{rank} ({count} messages)"
  },
  "myStatsTitle": {
    "zh-CN": "{name} 的{scope}消息统计",
    "en": "{name} · {scope} message statistics"
  },
  "todayMessages": {
    "zh-CN": "今日: {count} 条",
    "en": "Today: {count} messages"
  },
  "weekMessages": {
    "zh-CN": "本周: {count} 条",
    "en": "This week: {count} messages"
  },
  "monthMessages": {
    "zh-CN": "本月: {count} 条",
    "en": "This month: {count} messages"
  },
  "totalMessages": {
    "zh-CN": "总计: {count} 条",
    "en": "Total: {count} messages"
  },
  "activeDays": {
    "zh-CN": "活跃天数: {count} 天",
    "en": "Active days: {count}"
  },
  "statsDb": {
    "zh-CN": "统计数据库尚未就绪",
    "en": "The statistics database is not ready"
  },
  "myStatsEmpty": {
    "zh-CN": "暂无你的消息记录",
    "en": "No message history for you yet"
  },
  "thisGroup": {
    "zh-CN": "本群",
    "en": "This group"
  },
  "global": {
    "zh-CN": "全局",
    "en": "All conversations"
  },
  "statsTodayGroup": {
    "zh-CN": "今日本群消息统计",
    "en": "Today's group message statistics"
  },
  "statsTodayAll": {
    "zh-CN": "今日全局消息统计",
    "en": "Today's message statistics"
  },
  "statsWeekGroup": {
    "zh-CN": "本周本群消息统计",
    "en": "This week's group message statistics"
  },
  "statsWeekAll": {
    "zh-CN": "本周全局消息统计",
    "en": "This week's message statistics"
  },
  "statsMonthGroup": {
    "zh-CN": "本月话唠排行",
    "en": "This month's most active members"
  },
  "statsMonthAll": {
    "zh-CN": "全局话唠排行",
    "en": "Most active members"
  },
  "noStats": {
    "zh-CN": "暂无统计数据",
    "en": "No statistics yet"
  },
  "participants": {
    "zh-CN": "参与",
    "en": "Participants"
  },
  "messages": {
    "zh-CN": "消息",
    "en": "Messages"
  },
  "myRank": {
    "zh-CN": "我的排名",
    "en": "Your rank"
  },
  "leaderboard": {
    "zh-CN": "排行榜",
    "en": "Leaderboard"
  },
  "today": {
    "zh-CN": "今日",
    "en": "Today"
  },
  "week": {
    "zh-CN": "本周",
    "en": "This week"
  },
  "month": {
    "zh-CN": "本月",
    "en": "This month"
  },
  "total": {
    "zh-CN": "总计",
    "en": "Total"
  },
  "cardMeta": {
    "zh-CN": "共 {people} 人 · {messages} 条消息{rank}",
    "en": "{people} participants · {messages} messages{rank}"
  },
  "messageCount": {
    "zh-CN": "{count} 条",
    "en": "{count} messages"
  },
  "myStatsSubtitle": {
    "zh-CN": "{scope}消息统计 · 活跃 {days} 天",
    "en": "{scope} message statistics · {days} active days"
  },
  "cardRank": {
    "zh-CN": " · 你第 {rank} 名",
    "en": " · Your rank: #{rank}"
  },
  "analysisNamed": {
    "zh-CN": "{name} · 群日常分析",
    "en": "{name} · Group activity report"
  },
  "analysisRange": {
    "zh-CN": "{start} 至 {end} · 最近 {days} 天",
    "en": "{start} to {end} · Last {days} days"
  },
  "analysis": {
    "zh-CN": "群日常分析",
    "en": "Group activity report"
  },
  "topics": {
    "zh-CN": "热门话题",
    "en": "Popular topics"
  },
  "quotes": {
    "zh-CN": "金句精选",
    "en": "Selected quotes"
  },
  "profiles": {
    "zh-CN": "用户画像",
    "en": "Member profiles"
  },
  "characters": {
    "zh-CN": "字数",
    "en": "Characters"
  },
  "active": {
    "zh-CN": "活跃",
    "en": "Peak activity"
  },
  "hourDistribution": {
    "zh-CN": "每小时消息分布",
    "en": "Hourly message distribution"
  },
  "analysisTextNamed": {
    "zh-CN": "【{name}】群日常分析",
    "en": "[{name}] Group activity report"
  },
  "analysisTextRange": {
    "zh-CN": "📅 统计区间：{start} 至 {end}（最近 {days} 天）",
    "en": "📅 Period: {start} to {end} (last {days} days)"
  },
  "analysisMessages": {
    "zh-CN": "💬 消息总数：{count} 条",
    "en": "💬 Messages: {count}"
  },
  "analysisPeople": {
    "zh-CN": "👥 参与人数：{count} 人",
    "en": "👥 Participants: {count}"
  },
  "analysisChars": {
    "zh-CN": "📝 总字数：{count} 字",
    "en": "📝 Characters: {count}"
  },
  "analysisPeak": {
    "zh-CN": "⏰ 最活跃时段：{start}:00 - {end}:00",
    "en": "⏰ Peak activity: {start}:00 - {end}:00"
  },
  "hourDistributionText": {
    "zh-CN": "📈 每小时消息分布：",
    "en": "📈 Hourly message distribution:"
  },
  "llmTopics": {
    "zh-CN": "🔥 热门话题（LLM 提取）：",
    "en": "🔥 Popular topics (AI extracted):"
  },
  "llmQuotes": {
    "zh-CN": "💬 金句（LLM 筛选）：",
    "en": "💬 Selected quotes (AI selected):"
  },
  "llmProfiles": {
    "zh-CN": "👤 用户画像/称号（LLM）：",
    "en": "👤 Member profiles/titles (AI):"
  },
  "keywordStorage": {
    "zh-CN": "关键词管理需要 Database Host 的持久状态服务；请配置数据库，或显式设置 ephemeralKeywords: true 使用临时词库",
    "en": "Keyword management requires persistent Database Host state; configure a database or explicitly enable ephemeralKeywords: true for temporary storage"
  },
  "keywordLimit": {
    "zh-CN": "群关键词最多 200 条",
    "en": "Group keywords are limited to 200 entries"
  },
  "keywordSize": {
    "zh-CN": "词库 JSON 必须小于 64 KiB（UTF-8）；请缩短回复或删除条目",
    "en": "Keyword dictionary JSON must be below 64 KiB (UTF-8); shorten replies or remove entries"
  },
  "keywordLength": {
    "zh-CN": "关键词须为 1–200 字符，回复须为 1–2000 字符",
    "en": "Keyword must contain 1–200 characters and reply 1–2000 characters"
  },
  "keywordRequired": {
    "zh-CN": "请提供关键词和回复内容",
    "en": "Provide a keyword and reply"
  },
  "keywordAdded": {
    "zh-CN": "已添加关键词「{keyword}」→「{reply}」",
    "en": "Keyword added: “{keyword}” → “{reply}”"
  },
  "keywordRemoveRequired": {
    "zh-CN": "请提供要删除的关键词",
    "en": "Provide the keyword to remove"
  },
  "keywordMissing": {
    "zh-CN": "关键词「{keyword}」不存在",
    "en": "Keyword “{keyword}” does not exist"
  },
  "keywordRemoved": {
    "zh-CN": "已删除关键词「{keyword}」",
    "en": "Keyword removed: “{keyword}”"
  },
  "keywordEmpty": {
    "zh-CN": "当前没有设置任何关键词",
    "en": "No keywords configured"
  },
  "keywordList": {
    "zh-CN": "关键词列表（共 {count} 条）：\n{lines}",
    "en": "Keywords ({count}):\n{lines}"
  },
  "userCheckinEmpty": {
    "zh-CN": "用户 {user} 没有签到记录",
    "en": "No check-ins for {user}"
  },
  "userCheckinInfo": {
    "zh-CN": "{name}: 积分={points}, 累计={total}天, 连续={streak}天, 最长={max}天, 上次={last}",
    "en": "{name}: points={points}, check-ins={total} days, streak={streak} days, longest={max} days, last={last}"
  },
  "checkinOverview": {
    "zh-CN": "签到系统统计\n总用户: {users}\n总积分: {points}\n今日签到: {today}人",
    "en": "Check-in statistics\nUsers: {users}\nPoints: {points}\nChecked in today: {today}"
  },
  "rankEmpty": {
    "zh-CN": "暂无排行数据",
    "en": "No leaderboard data yet"
  },
  "pointsToolRow": {
    "zh-CN": "{rank}. {name} — {points}分 (连续{days}天)",
    "en": "{rank}. {name} — {points} points ({days}-day streak)"
  },
  "periodStatsEmpty": {
    "zh-CN": "{period} 暂无消息统计数据",
    "en": "{period}: no message statistics yet"
  },
  "statsOverview": {
    "zh-CN": "消息统计 ({period})\n总消息: {total}条, 活跃用户: {users}人\n{lines}",
    "en": "Message statistics ({period})\nMessages: {total}, active members: {users}\n{lines}"
  },
  "userStatsEmpty": {
    "zh-CN": "用户 {user} 暂无消息记录",
    "en": "No message history for {user}"
  },
  "userStatsInfo": {
    "zh-CN": "{name} 的统计\n今日: {today}条\n本周: {week}条\n总计: {total}条\n活跃天数: {days}天",
    "en": "Statistics for {name}\nToday: {today} messages\nThis week: {week} messages\nTotal: {total} messages\nActive days: {days}"
  },
  "announcement": {
    "zh-CN": "📢 群公告：\n{message}",
    "en": "📢 Group announcement:\n{message}"
  }
});
