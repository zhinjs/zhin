/**
 * Zhin.js Playground 示例插件
 * 提供基本的交互命令，帮助用户体验框架功能
 */
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, addMiddleware, logger } = usePlugin()

// 欢迎命令
addCommand(
  new MessageCommand('hello [name:text]')
    .desc('向你问好')
    .action(async (_message, result) => {
      const name = result.params.name || '世界'
      return `你好，${name}！欢迎使用 Zhin.js Playground 🤖`
    }),
)

// 帮助命令
addCommand(
  new MessageCommand('playground')
    .desc('查看 Playground 可用命令')
    .action(async () => {
      return [
        '📝 Zhin.js Playground 可用命令：',
        '',
        '  hello [name]  — 向你问好',
        '  playground    — 查看本帮助',
        '  echo <msg>    — 复读你的消息',
        '  time          — 查看当前时间',
        '  dice [faces]  — 掷骰子',
        '',
        '在左侧 Sandbox 聊天窗口输入命令即可体验！',
      ].join('\n')
    }),
)

// 复读命令
addCommand(
  new MessageCommand('echo <message:text>')
    .desc('复读你说的话')
    .action(async (_message, result) => {
      return result.params.message
    }),
)

// 时间命令
addCommand(
  new MessageCommand('time')
    .desc('查看当前服务器时间')
    .action(async () => {
      return `🕐 当前时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    }),
)

// 掷骰子
addCommand(
  new MessageCommand('dice [faces:number]')
    .desc('掷骰子')
    .action(async (_message, result) => {
      const faces = result.params.faces || 6
      const roll = Math.floor(Math.random() * faces) + 1
      return `🎲 掷出了 ${roll}（${faces} 面骰）`
    }),
)

// 消息日志中间件
addMiddleware(async (message, next) => {
  logger.info(`[Playground] 收到消息: ${message.$raw}`)
  await next()
})
