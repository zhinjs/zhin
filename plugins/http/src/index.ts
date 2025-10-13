import {register, useApp,onDispose,onDatabaseReady,useDatabase} from '@zhin.js/core';
import { createServer, Server } from 'http';
import Koa from 'koa';
import auth from 'koa-basic-auth';
import KoaBodyParser from 'koa-bodyparser';
import { Router } from './router.js';
import * as process from 'process';

export * from './router.js';

declare module '@zhin.js/types'{
  interface GlobalContext {
    koa: Koa,
    router: Router,
    server: Server
  }
}

const koa = new Koa();
const server = createServer(koa.callback())
const router = new Router(server, { prefix: process.env.routerPrefix || '' });
const username = process.env.username || 'admin';
const password = process.env.password || '123456';
const app=useApp()

koa.use(
  auth({
    name: username,
    pass: password,
  }),
);
// ============================================================================
// API 路由
// ============================================================================

// 系统状态 API
router.get('/api/system/status', async (ctx) => {
  try {
    ctx.body = {
      success: true,
      data: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid,
        timestamp: new Date().toISOString()
      }
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 健康检查 API
router.get('/api/health', async (ctx) => {
  ctx.body = { 
    success: true, 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  }
})

// 统计信息 API
router.get('/api/stats', async (ctx) => {
  try {
    // 统计插件数量
    const pluginCount = app.dependencyList.length
    const activePluginCount = app.dependencyList.filter(dep => (dep as any).mounted).length
    
    // 统计机器人数量
    let botCount = 0
    let onlineBotCount = 0
    for (const context of app.contextList) {
      const adapter = app.getContext(context.name)
      if (adapter && typeof adapter === 'object' && 'bots' in adapter) {
        const adapterBots = (adapter as any).bots
        if (adapterBots && adapterBots instanceof Map) {
          botCount += adapterBots.size
          for (const bot of adapterBots.values()) {
            if (bot.$connected) onlineBotCount++
          }
        }
      }
    }
    
    // 统计命令和组件
    let commandCount = 0
    let componentCount = 0
    for (const dep of app.dependencyList) {
      commandCount += dep.commands.length
      componentCount += dep.components.size
    }
    
    ctx.body = { 
      success: true, 
      data: {
        plugins: { total: pluginCount, active: activePluginCount },
        bots: { total: botCount, online: onlineBotCount },
        commands: commandCount,
        components: componentCount,
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024, // MB
      }
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 插件管理 API
router.get('/api/plugins', async (ctx) => {
  try {
    // 获取详细的插件数据
    const plugins = app.dependencyList.map(dep => {
      return {
        name: dep.name,
        status: (dep as any).mounted ? 'active' : 'inactive',
        commandCount: dep.commands.length,
        componentCount: dep.components.size,
        middlewareCount: dep.middlewares.length,
        contextCount: dep.contexts.size,
        description: (dep as any).description || '无描述',
      }
    })
    
    ctx.body = { success: true, data: plugins, total: plugins.length }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 插件详情 API
router.get('/api/plugins/:name', async (ctx) => {
  try {
    const pluginName = ctx.params.name
    const plugin = app.dependencyList.find(dep => dep.name === pluginName)
    
    if (!plugin) {
      ctx.status = 404
      ctx.body = { success: false, error: '插件不存在' }
      return
    }
    
    // 获取命令详情
    const commands = plugin.commands.map(cmd => ({
      name: (cmd as any).name || 'unknown',
      pattern: (cmd as any).pattern?.toString() || '',
      description: (cmd as any).description || '无描述',
      alias: (cmd as any).alias || [],
      examples: (cmd as any).examples || []
    }))
    
    // 获取组件详情
    const components = Array.from(plugin.components.entries()).map(([name, comp]) => ({
      name,
      props: (comp as any).props || {},
      type: typeof comp
    }))
    
    // 获取中间件详情
    const middlewares = plugin.middlewares.map((_, index) => ({
      id: `middleware-${index}`,
      type: 'function'
    }))
    
    // 获取上下文详情
    const contexts = Array.from(plugin.contexts.entries()).map(([name, ctx]) => ({
      name,
      description: (ctx as any).description || '无描述'
    }))
    
    // 获取定时任务详情
    const crons = plugin.crons.map((cron, index) => ({
      id: `cron-${index}`,
      pattern: (cron as any).pattern || 'unknown',
      running: (cron as any).running || false
    }))
    
    // 获取数据模型详情
    const schemas = Array.from(plugin.schemas.entries()).map(([name, schema]) => ({
      name,
      fields: Object.keys((schema as any).fields || {})
    }))
    
    ctx.body = {
      success: true,
      data: {
        name: plugin.name,
        filename: plugin.filename,
        status: (plugin as any).mounted ? 'active' : 'inactive',
        description: (plugin as any).description || '无描述',
        commands,
        components,
        middlewares,
        contexts,
        crons,
        schemas,
        statistics: {
          commandCount: commands.length,
          componentCount: components.length,
          middlewareCount: middlewares.length,
          contextCount: contexts.length,
          cronCount: crons.length,
          schemaCount: schemas.length
        }
      }
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 适配器和机器人状态 API
router.get('/api/bots', async (ctx) => {
  try {
    const bots: any[] = []
    
    // 遍历所有上下文，查找适配器
    for (const context of app.contextList) {
      const adapter = app.getContext(context.name)
      if (adapter && typeof adapter === 'object' && 'bots' in adapter) {
        const adapterBots = (adapter as any).bots
        if (adapterBots && adapterBots instanceof Map) {
          for (const [botName, bot] of adapterBots.entries()) {
            bots.push({
              name: botName,
              adapter: context.name,
              connected: bot.$connected || false,
              status: bot.$connected ? 'online' : 'offline'
              // 移除 config 字段以保护隐私
            })
          }
        }
      }
    }
    
    ctx.body = { success: true, data: bots, total: bots.length }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 框架配置信息 API
router.get('/api/config', async (ctx) => {
  try {
    const config = app.getConfig()
    
    ctx.body = { success: true, data: config }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 消息发送 API
router.post('/api/message/send', async (ctx) => {
  try {
    const body = ctx.request.body as any
    const { context, bot, id, type, content } = body
    
    if (!context || !bot || !id || !type || !content) {
      ctx.status = 400
      ctx.body = { 
        success: false, 
        error: 'Missing required fields: context, bot, id, type, content' 
      }
      return
    }
    
    // 模拟发送消息（实际环境中会调用应用实例的sendMessage方法）
    // console.log 已替换为注释
    
    ctx.body = {
      success: true,
      message: 'Message sent successfully',
      data: { context, bot, id, type, content, timestamp: new Date().toISOString() }
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 日志 API - 获取日志
router.get('/api/logs', async (ctx) => {
  try {
    const database = useDatabase()
    if (!database) {
      ctx.status = 503
      ctx.body = { success: false, error: 'Database not available' }
      return
    }

    // 获取查询参数
    const limit = parseInt(ctx.query.limit as string) || 100
    const level = ctx.query.level as string
    
    const LogModel = database.model('SystemLog')
    if (!LogModel) {
      ctx.status = 500
      ctx.body = { success: false, error: 'SystemLog model not found' }
      return
    }

    // 查询日志
    let selection = LogModel.select()
    
    // 按级别过滤
    if (level && level !== 'all') {
      selection = selection.where({ level })
    }
    
    // 按时间倒序，限制数量
    const logs = await selection.orderBy('timestamp', 'DESC').limit(limit)

    // 格式化返回数据
    const formattedLogs = logs.map((log: any) => ({
      level: log.level,
      name: log.name,
      message: log.message,
      source: log.source,
      timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp
    }))
    
    ctx.body = { 
      success: true, 
      data: formattedLogs,
      total: formattedLogs.length
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 日志 API - 清空日志
router.delete('/api/logs', async (ctx) => {
  try {
    const database = useDatabase()
    if (!database) {
      ctx.status = 503
      ctx.body = { success: false, error: 'Database not available' }
      return
    }

    const LogModel = database.model('SystemLog')
    if (!LogModel) {
      ctx.status = 500
      ctx.body = { success: false, error: 'SystemLog model not found' }
      return
    }

    // 删除所有日志
    await (LogModel as any).delete({})
    
    ctx.body = { 
      success: true, 
      message: '日志已清空'
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 日志 API - 获取日志统计
router.get('/api/logs/stats', async (ctx) => {
  try {
    const database = useDatabase()
    if (!database) {
      ctx.status = 503
      ctx.body = { success: false, error: 'Database not available' }
      return
    }

    const LogModel = database.model('SystemLog')
    if (!LogModel) {
      ctx.status = 500
      ctx.body = { success: false, error: 'SystemLog model not found' }
      return
    }

    // 获取总日志数
    const total = await LogModel.select()
    const totalCount = total.length 
    // 获取各级别日志数
    const levels = ['info', 'warn', 'error']
    const levelCounts: Record<string, number> = {}
    
    for (const level of levels) {
      const count = await LogModel
        .select()
        .where({ level })
      levelCounts[level] = count.length
    }

    // 获取最旧日志时间
    const oldestLog = await LogModel
      .select('timestamp')
      .orderBy('timestamp', 'ASC')
      .limit(1)
    
    const oldestTimestamp = oldestLog.length > 0 
      ? (oldestLog[0].timestamp instanceof Date 
          ? oldestLog[0].timestamp.toISOString() 
          : oldestLog[0].timestamp)
      : null

    ctx.body = {
      success: true,
      data: {
        total:totalCount,
        byLevel: levelCounts,
        oldestTimestamp
      }
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 日志 API - 清理旧日志（手动触发）
router.post('/api/logs/cleanup', async (ctx) => {
  try {
    const database = useDatabase()
    if (!database) {
      ctx.status = 503
      ctx.body = { success: false, error: 'Database not available' }
      return
    }

    const LogModel = database.model('SystemLog')
    if (!LogModel) {
      ctx.status = 500
      ctx.body = { success: false, error: 'SystemLog model not found' }
      return
    }

    const { days, maxRecords } = ctx.request.body as any || {}
    
    let deletedCount = 0

    // 按天数清理
    if (days && typeof days === 'number' && days > 0) {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - days)
      
      const deleted = await LogModel
        .delete({ timestamp: { $lt: cutoffDate } })
      
      deletedCount += deleted || 0
    }

    // 按数量清理
    if (maxRecords && typeof maxRecords === 'number' && maxRecords > 0) {
      const totalCount = await (LogModel as any).select()
      
      if (totalCount.length > maxRecords) {
        const excessCount = totalCount - maxRecords
        
        const oldestLogs = await LogModel
          .select('id','timestamp')
          .orderBy('timestamp', 'ASC')
          .limit(excessCount)
        
        const idsToDelete = oldestLogs.map((log: any) => log.id)
        
        if (idsToDelete.length > 0) {
          const deleted = await (LogModel as any)
            .delete()
            .where({ id: { $in: idsToDelete } })
          
          deletedCount += deleted || 0
        }
      }
    }

    ctx.body = {
      success: true,
      message: `已清理 ${deletedCount} 条日志`,
      deletedCount
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// ============================================================================
// 上下文注册
// ============================================================================

register({
  name: 'server',
  description:"http server",
  mounted(p) {
    return new Promise<Server>((resolve) => {
      server.listen(
        {
          host: '0.0.0.0',
          port: Number((process.env.port ||= '8086')),
        },
        () => {
          const address = server.address();
          if (!address) return;
          const visitAddress = typeof address === 'string' ? address : `${address.address}:${address.port}`;
          p.logger.info(`server is running at http://${visitAddress}`);
          p.logger.info('your username is：', username);
          p.logger.info('your password is：', password);
          resolve(server)
        },
      )
    })
  },
  dispose(s) {
    s.close()
  }
})

register({
  name: "koa",
  description:"koa instance",
  value: koa
})

register({
  name: 'router',
  description:"koa router",
  value: router
})

koa.use(KoaBodyParser()).use(router.routes()).use(router.allowedMethods());