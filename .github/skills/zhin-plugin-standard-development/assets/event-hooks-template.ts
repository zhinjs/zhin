// @ts-nocheck
import type { SendOptions } from 'zhin.js'
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

plugin.on('message.group.receive', async (message) => {
  plugin.logger.info(`group message from ${message.$sender.id}`)
})

plugin.on('before.sendMessage', async (options: SendOptions) => {
  if (!options.content) {
    return options
  }

  return {
    ...options,
    content: options.content,
  }
})

plugin.onDispose(() => {
  plugin.logger.info('event hooks disposed')
})