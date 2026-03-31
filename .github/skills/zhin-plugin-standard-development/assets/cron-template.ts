// @ts-nocheck
import { Cron, Schema, usePlugin } from 'zhin.js'

const plugin = usePlugin()
const { addCron, declareConfig, logger } = plugin

const config = declareConfig('my-plugin', Schema.object({
  pollCron: Schema.string().default('*/5 * * * *').description('Cron expression for polling'),
}))

addCron(
  new Cron(config.pollCron, async () => {
    logger.info('cron job executed')
  }),
)