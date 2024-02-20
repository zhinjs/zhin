import { Plugin } from 'zhin';
import { createServer, ViteDevServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import type {} from '@zhinjs/plugin-http-server';
import * as process from 'process';
import { extname, resolve } from 'path';
import { createReadStream } from 'fs';
declare module 'zhin' {
  namespace App {
    interface Services {
      viteServer: ViteDevServer;
      addClient(entry: string): () => void;
      clients: string[];
    }
  }
}
export const name = 'Web端';
const plugin = new Plugin('Web端');
plugin.mounted(async app => {
  const viteServer = await createServer({
    root: process.cwd() + '/',
    base: '/client/',
    plugins: [vue()],
    server: {
      middlewareMode: true,
      fs: {
        strict: false,
      },
    },
    build: {
      rollupOptions: {
        input: resolve(process.cwd(), 'index.html'),
      },
    },
  });
  plugin.router.all('(/.+)*', async (ctx: any, next: Function) => {
    await next();
    const name = ctx.path.slice(1);
    if (plugin.clients.includes(name)) {
      const filename = resolve(process.cwd(), name);
      ctx.type = extname(`/vite/@fs/${filename}`);
      return (ctx.body = createReadStream(filename));
    }
  });
  plugin.router.all(
    '/client(/.+)*',
    (ctx: any) =>
      new Promise(resolve => {
        viteServer.middlewares(ctx.req, ctx.res, resolve);
      }),
  );
  plugin.service('viteServer', viteServer);

  plugin.service('clients', []);
  plugin.service('addClient', entry => {
    plugin.clients.push(entry);
    return () => {
      plugin.clients.splice(plugin.clients.indexOf(entry), 1);
    };
  });
});
plugin.required('koa', 'router', 'server');
export default plugin;
