/**
 * @zhin.js/plugin-group-admin
 *
 * 群管理插件 —— 入群欢迎、关键词回复、撤回提示、AI 群公告工具
 *
 * 功能：
 *   - 入群欢迎：监听 notice.receive 中的成员加入事件，发送可自定义欢迎语
 *   - 关键词回复：中间件匹配消息关键词并自动回复，支持增删查命令管理
 *   - 撤回提示：监听 notice.receive 中的群消息撤回事件，通知群内
 *   - AI 工具：group_announce，AI 可调用发送群公告
 *
 * 命令：
 *   添加关键词 <keyword:text> <reply:text>  添加关键词回复对
 *   删除关键词 <keyword:text>               删除关键词
 *   关键词列表                               查看所有关键词
 */
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const plugin = usePlugin()
const { addCommand, addMiddleware, addTool, logger } = plugin

// ─── 入群欢迎 ───────────────────────────────────────────────────────────────

const WELCOME_TEMPLATE = '欢迎新成员加入本群！'

plugin.on('notice.receive', async (notice) => {
  if (notice.$type !== 'group_member_increase') return
  if (notice.$channel.type !== 'group') return

  const targetName = notice.$target?.name || notice.$target?.id || '新成员'
  const welcomeMsg = `🎉 ${targetName}，${WELCOME_TEMPLATE}`

  try {
    const adapter = plugin.inject(notice.$adapter as any) as any
    if (!adapter) return
    const bot = adapter.bots?.find((b: any) => b.$config?.name === notice.$bot || b.$id === notice.$bot)
    if (!bot) return
    await bot.$sendMessage({
      context: notice.$adapter,
      bot: notice.$bot,
      content: welcomeMsg,
      id: notice.$channel.id,
      type: notice.$channel.type,
    })
  } catch (e: any) {
    logger.warn(`发送入群欢迎消息失败: ${e.message}`)
  }
})

// ─── 关键词回复 ──────────────────────────────────────────────────────────────

const keywords = new Map<string, string>()

// 中间件：匹配关键词自动回复
addMiddleware(async (message, next) => {
  if (message.$channel.type !== 'group') {
    await next()
    return
  }

  const raw = message.$raw?.trim()
  if (!raw) {
    await next()
    return
  }

  for (const [keyword, reply] of keywords) {
    if (raw.includes(keyword)) {
      await message.$reply(reply)
      return
    }
  }

  await next()
})

// 命令：添加关键词
addCommand(
  new MessageCommand('添加关键词 <keyword:text> <reply:text>')
    .desc('添加一个关键词自动回复对')
    .action(async (_message, result) => {
      const { keyword, reply } = result.params as { keyword: string; reply: string }
      if (!keyword || !reply) return '请提供关键词和回复内容'
      keywords.set(keyword, reply)
      return `已添加关键词「${keyword}」→「${reply}」`
    }),
)

// 命令：删除关键词
addCommand(
  new MessageCommand('删除关键词 <keyword:text>')
    .desc('删除一个关键词')
    .action(async (_message, result) => {
      const { keyword } = result.params as { keyword: string }
      if (!keyword) return '请提供要删除的关键词'
      if (!keywords.has(keyword)) return `关键词「${keyword}」不存在`
      keywords.delete(keyword)
      return `已删除关键词「${keyword}」`
    }),
)

// 命令：关键词列表
addCommand(
  new MessageCommand('关键词列表')
    .desc('查看所有关键词回复对')
    .action(async () => {
      if (keywords.size === 0) return '当前没有设置任何关键词'
      const lines = Array.from(keywords.entries()).map(
        ([k, v], i) => `${i + 1}. 「${k}」→「${v}」`,
      )
      return `关键词列表（共 ${keywords.size} 条）：\n${lines.join('\n')}`
    }),
)

// ─── 撤回提示 ───────────────────────────────────────────────────────────────

plugin.on('notice.receive', async (notice) => {
  if (notice.$type !== 'group_recall') return
  if (notice.$channel.type !== 'group') return

  const operatorName = notice.$operator?.name || notice.$operator?.id || '某人'
  const msg = `⚠️ ${operatorName} 撤回了一条消息`

  try {
    const adapter = plugin.inject(notice.$adapter as any) as any
    if (!adapter) return
    const bot = adapter.bots?.find((b: any) => b.$config?.name === notice.$bot || b.$id === notice.$bot)
    if (!bot) return
    await bot.$sendMessage({
      context: notice.$adapter,
      bot: notice.$bot,
      content: msg,
      id: notice.$channel.id,
      type: notice.$channel.type,
    })
  } catch (e: any) {
    logger.warn(`发送撤回提示失败: ${e.message}`)
  }
})

// ─── AI 工具：群公告 ─────────────────────────────────────────────────────────

addTool(
  new ZhinTool('group_announce')
    .desc('向群聊发送公告/通知消息')
    .keyword('群公告', '通知', 'announce')
    .param('message', { type: 'string', description: '要发送的公告内容' }, true)
    .execute(async (args) => {
      const content = args.message as string
      if (!content?.trim()) return '公告内容不能为空'
      return `📢 群公告：\n${content}`
    })
    .toTool(),
)
