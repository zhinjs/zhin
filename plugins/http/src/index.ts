import {register, useApp} from '@zhin.js/core';
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

// 插件管理 API
router.get('/api/plugins', async (ctx) => {
  try {
    // 获取详细的插件数据
    const plugins = app.dependencyList.map(dep => {
      return {
        name:dep.name,
        command_count:dep.commands.length,
        component_count:dep.components.size,
        middleware_count:dep.middlewares.length,
        context_count:dep.contexts.size,
      }
    })
    
    ctx.body = { success: true, data: plugins }
  } catch (error) {
    ctx.status = 500
    ctx.body = { success: false, error: (error as Error).message }
  }
})

// 适配器管理 API
router.get('/api/adapters', async (ctx) => {
  try {
    // 模拟适配器数据
    const adapters = app.contextList.map(ctx=>{
      return {
        name:ctx.name,
        desc:ctx.description,
      }
    })
    
    ctx.body = { success: true, data: adapters }
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

// 日志 API
router.get('/api/logs', async (ctx) => {
  try {
    // 模拟日志数据
    const logs = [
      {
        level: 'info',
        message: 'HTTP服务器启动成功',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        source: 'http'
      },
      {
        level: 'info', 
        message: 'Web控制台已就绪',
        timestamp: new Date(Date.now() - 50000).toISOString(),
        source: 'console'
      },
      {
        level: 'warn',
        message: 'KOOK适配器连接不稳定',
        timestamp: new Date(Date.now() - 30000).toISOString(),
        source: 'kook'
      },
      {
        level: 'error',
        message: 'ICQQ登录失败',
        timestamp: new Date(Date.now() - 20000).toISOString(),
        source: 'icqq'
      }
    ]
    
    ctx.body = { success: true, data: logs }
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