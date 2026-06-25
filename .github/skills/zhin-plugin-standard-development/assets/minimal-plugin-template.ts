// @ts-nocheck
import { MessageCommand, usePlugin } from 'zhin.js'

const plugin = usePlugin()
const { addCommand, root } = plugin

addCommand(
  new MessageCommand('hello [name:text]')
    .description('Example command')
    .action(async (_message, result) => {
      const name = result.params.name || 'world'
      return `hello, ${name}`
    }),
)

root.addMiddleware(async (message, next) => {
  if (!message.$raw.trim()) {
    return
  }

  await next()
})