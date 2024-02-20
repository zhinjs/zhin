import { loadYamlConfigOrCreate, Plugin, saveYamlConfig } from 'zhin';
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
    name: process.env.username + '',
    pass: process.env.password + '',
  }),
);
const server = createServer(koa.callback());
const router = new Router(server, { prefix: process.env.routerPrefix || '' });
router.get('/api/plugins', (ctx: Context) => {
  ctx.body = httpServer.app!.pluginList.map(plugin => {
    return {
      name: plugin.name,
      status: plugin.status,
      filePath: plugin.filePath,
      middlewareCount: plugin.middlewares.length,
      commands: [...plugin.commands.values()].map(command => {
        return {
          name: command.name,
          desc: command.config.desc,
          alias: command.aliasNames,
          hidden: command.config.hidden,
          help: command.help(),
        };
      }),
      services: [...plugin.services.entries()].map(([name]) => {
        return {
          name,
        };
      }),
    };
  });
});
router.get('/api/config', (ctx: Context) => {
  ctx.body = httpServer.app!.config;
});
router.get('/api/adapter/:name/config', (ctx: Context) => {
  ctx.body = loadYamlConfigOrCreate(`${ctx.params.name}.yaml`, '[]');
});
router.post('/api/adapter/:name/config', (ctx: Context) => {
  saveYamlConfig(ctx.params.name, ctx.request.body);
});
router.get('/api/adapters', (ctx: Context) => {
  ctx.body = [...httpServer.app!.adapters.values()].map(adapter => {
    return {
      name: adapter.name,
      botsCount: adapter.bots.length,
    };
  });
});
router.get('/api/commands', (ctx: Context) => {
  ctx.body = [...httpServer.app!.commandList].map(command => {
    return {
      name: command.name,
      desc: command.config.desc,
      alias: command.aliasNames,
      hidden: command.config.hidden,
      help: command.help(),
    };
  });
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
