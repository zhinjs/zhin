import { Command, Plugin } from 'zhin';
import { createServer, Server } from 'http';
import Koa, { Context } from 'koa';
import auth from 'koa-basic-auth';
import KoaBodyParser from 'koa-bodyparser';
import { Router } from '@/router';
import * as process from 'process';
export * from './router';
const koa = new Koa();
koa.use(
  auth({
    name: process.env.username || '',
    pass: process.env.password || '',
  }),
);
const server = createServer(koa.callback());
const router = new Router(server, { prefix: process.env.routerPrefix || '' });
const outputCommand = (command: Command) => {
  return {
    name: command.name,
    desc: command.config.desc,
    alias: command.aliasNames,
    hidden: command.config.hidden,
    help: command.help(),
  };
};
router.get('/api/plugins', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = httpServer.app!.pluginList.map(plugin => {
    return {
      full_name: plugin.name,
      display_name: plugin.display_name,
      status: plugin.status,
      middlewareCount: plugin.middlewares.length,
      commands: [...plugin.commands.values()].map(outputCommand),
      services: [...plugin.services.entries()].map(([name]) => name),
    };
  });
});
router.get('/api/plugin/:name/commands', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = [...(httpServer.app?.plugins.get(ctx.params.name)?.commands.values() || [])].map(outputCommand);
});
router.get('/api/config', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = httpServer.app!.config;
});
router.get('/api/adapters', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = [...httpServer.app!.adapters.values()].map(adapter => {
    return {
      name: adapter.name,
      bots: adapter.bots.map(bot => {
        return bot.unique_id;
      }),
    };
  });
});
router.get('/api/adapter/:name/bots', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body =
    httpServer.app?.adapters.get(ctx.params.name)?.bots.map(bot => {
      return bot.unique_id;
    }) || [];
});
router.get('/api/bots', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = [...(httpServer.app?.adapters.values() || [])].reduce((result, adp) => {
    return result.concat(
      adp.bots.map(bot => {
        return bot.unique_id;
      }),
    );
  }, [] as any[]);
});
router.get('/api/commands', (ctx: Context) => {
  ctx.response.headers['Content-Type'] = 'application/json';
  ctx.body = [...httpServer.app!.commandList].map(outputCommand);
});
const httpServer = new Plugin('http-server');
httpServer.service('server', server).service('koa', koa).service('router', router);
koa.use(KoaBodyParser()).use(router.routes()).use(router.allowedMethods());
server.listen(Number((process.env.port ||= '8086')), () => {
  const address = server.address();
  if (!address) return;
  httpServer.app?.logger.mark('server start at', address);
});
httpServer.on('plugin-beforeUnmount', () => {
  server.close();
});
declare module 'zhin' {
  namespace App {
    interface Services {
      koa: Koa;
      router: Router;
      server: Server;
    }
  }
}
export default httpServer;
