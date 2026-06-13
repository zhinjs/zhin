/**
 * 生活助手插件 — 日程提醒、知识查询、对话记忆
 */
import { usePlugin, MessageCommand, Cron } from 'zhin.js'

const { addCommand, addCron, addTool, onMounted, logger } = usePlugin()

// --- 命令 ---

addCommand(
  new MessageCommand('remind <text:string>')
    .desc('设置提醒（示例：remind 明天下午3点开会）')
    .action((_, result) => {
      return `✅ 已记录提醒：${result.params.text}\n（提示：实际提醒需配合 cron 定时任务）`
    }),
)

addCommand(
  new MessageCommand('mood [note:string]')
    .desc('记录今日心情')
    .action((_, result) => {
      const note = result.params.note || '心情不错'
      return `📝 已记录：${new Date().toLocaleDateString('zh-CN')} — ${note}`
    }),
)

// --- AI 工具 ---

addTool({
  name: 'get_current_time',
  description: '获取当前日期和时间',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    return new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'long',
    })
  },
})

// --- 定时任务 ---

addCron(
  new Cron('0 8 * * *', async () => {
    logger.info('早安提醒触发')
    // 实际推送需要配置 IM 适配器
  }),
)

addCron(
  new Cron('0 22 * * *', async () => {
    logger.info('晚安提醒触发')
  }),
)

// --- 生命周期 ---

onMounted(() => {
  logger.info('生活助手插件已启动')
})
