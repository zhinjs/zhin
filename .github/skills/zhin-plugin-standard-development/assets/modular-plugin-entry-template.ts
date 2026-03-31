// @ts-nocheck
import { Schema, usePlugin } from 'zhin.js'

const plugin = usePlugin()

export const config = plugin.declareConfig('my-plugin', Schema.object({
  enabled: Schema.boolean().default(true).description('Whether the plugin is enabled'),
}))

import './commands/index.js'
import './middlewares/index.js'

plugin.useContext('database', async (database) => {
  const { registerDatabaseFeatures } = await import('./services/database.js')
  return registerDatabaseFeatures(plugin, database)
})

plugin.useContext('router', async (router) => {
  const { registerRoutes } = await import('./services/http.js')
  return registerRoutes(plugin, router)
})

plugin.useContext('web', async (web) => {
  const { registerWebEntry } = await import('./services/web.js')
  return registerWebEntry(web)
})