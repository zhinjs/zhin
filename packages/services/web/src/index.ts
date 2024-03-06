import { Plugin } from 'zhin';
import WebSocket from 'ws';
import vue from '@vitejs/plugin-vue';
import type {} from '@zhinjs/plugin-http-server';
import * as fs from 'fs';
import * as path from 'path';

declare module 'zhin' {
  namespace App {
    interface Services {
      viteServer: import('vite').ViteDevServer;

      addEntry(entry: string): () => void;

      wsServer: WebSocket.Server;
      entries: Record<string, string>;
    }
  }
}
export const name = 'Web端';
const plugin = new Plugin('Web端');
const createSyncMsg = (key: string, value: any) => {
  return {
    type: 'sync',
    data: {
      key,
      value,
    },
  };
};
const createAddMsg = (key: string, value: any) => {
  return {
    type: 'add',
    data: {
      key,
      value,
    },
  };
};
const createDeleteMsg = (key: string, value: any) => {
  return {
    type: 'delete',
    data: {
      key,
      value,
    },
  };
};
plugin.mounted(async () => {
  const root = path.resolve(__dirname, '../browser');
  const vite: typeof import('vite') = await import('vite');
  const viteServer = await vite.createServer({
    root: path.resolve(__dirname, '../browser'),
    base: '/vite/',
    plugins: [vue()],
    server: {
      middlewareMode: true,
      fs: {
        allow: [vite.searchForWorkspaceRoot(process.env.PWD!)],
      },
    },
    resolve: {
      dedupe: ['vue', 'vue-router', 'pinia', 'element-plus'],
      alias: {
        '@': path.resolve(__dirname, '../browser/src'),
        '@zhinjs/client': path.resolve(__dirname, '../browser'),
      },
    },
    optimizeDeps: {
      include: ['vue', 'vue-router', 'pinia', 'element-plus'],
    },
    build: {
      rollupOptions: {
        input: root + '/index.html',
      },
    },
  });
  plugin.router.all('(/.+)*', async (ctx: any, next: Function) => {
    await next();
    const name = ctx.path.slice(1);
    const sendFile = (filename: string) => {
      ctx.type = path.extname(filename);
      if (filename.endsWith('.ts')) ctx.type = 'text/javascript';
      return (ctx.body = fs.createReadStream(filename));
    };
    if (Object.keys(plugin.entries).includes(name)) {
      return sendFile(path.resolve(process.env.PWD!, plugin.entries[name]));
    }
    const filename = path.resolve(root, name);
    if (!filename.startsWith(root) && !filename.includes('node_modules')) {
      return (ctx.status = 403);
    }
    if (fs.existsSync(filename)) {
      const fileState = fs.statSync(filename);
      if (fileState.isFile()) return sendFile(filename);
    }
    const template = fs.readFileSync(path.resolve(root, 'index.html'), 'utf8');
    ctx.type = 'html';
    ctx.body = await viteServer.transformIndexHtml('', template);
  });
  plugin.router.all(
    '/vite(/.+)*',
    (ctx: any) =>
      new Promise(resolve => {
        viteServer.middlewares(ctx.req, ctx.res, resolve);
      }),
  );
  plugin.service('viteServer', viteServer);

  plugin.service('entries', {});
  plugin.service('addEntry', entry => {
    const hash = Date.now().toString(16);
    plugin.entries[hash] = `/vite/@fs/${entry}`;
    for (const ws of plugin.wsServer?.clients || []) {
      ws.send(JSON.stringify(createAddMsg('entries', plugin.entries[hash])));
    }
    return () => {
      for (const ws of plugin.wsServer?.clients || []) {
        ws.send(JSON.stringify(createDeleteMsg('entries', plugin.entries[hash])));
      }
      delete plugin.entries[hash];
    };
  });
  const wss: WebSocket.Server = plugin.router.ws('/server');
  plugin.service('wsServer', wss);
  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify(createSyncMsg('entries', Object.values(plugin.entries))));
  });
});
plugin.required('koa', 'router', 'server');
export default plugin;
