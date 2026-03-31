// @ts-nocheck
import type { Router, RouterContext } from '@zhin.js/http'

interface PluginLike {
  name?: string
}

export function registerRoutes(plugin: PluginLike, router: Router) {
  router.get('/pub/health', (ctx: RouterContext) => {
    ctx.body = {
      ok: true,
      plugin: plugin.name || 'plugin',
    }
  })

  router.get('/api/plugin/status', async (ctx: RouterContext) => {
    ctx.body = {
      enabled: true,
      uptime: process.uptime(),
    }
  })

  return () => {
    // If your router implementation returns disposers per route, release them here.
  }
}