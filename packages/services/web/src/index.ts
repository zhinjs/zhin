import { Plugin } from 'zhin';
import WebSocket from 'ws';
import vue from '@vitejs/plugin-vue';
import type {} from '@zhinjs/plugin-http-server';
import * as fs from 'fs';
import * as path from 'path';

declare module 'zhin' {
  namespace App {
    interface Services {
      web: WebServer;
    }
  }
}
export type WebServer = {
  vite: import('vite').ViteDevServer;
  addEntry(entry: string): () => void;
  ws: WebSocket.Server;
  entries: Record<string, string>;
};
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
  const root = path.resolve(path.dirname(require.resolve('@zhinjs/client')), '../app');
  const vite: typeof import('vite') = await import('vite');
  const viteServer = await vite.createServer({
    root,
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
        '@zhinjs/client': path.resolve(root, '../src'),
      },
    },
    optimizeDeps: {
      include: ['vue', '@ionic/vue-router', 'pinia', '@ionic/vue'],
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
    if (Object.keys(plugin.web.entries).includes(name)) {
      return sendFile(path.resolve(process.env.PWD!, plugin.web.entries[name]));
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
  plugin.service('web', {
    vite: viteServer,
    entries: {},
    addEntry(entry) {
      const hash = Date.now().toString(16);
      this.entries[hash] = `/vite/@fs/${entry}`;
      for (const ws of this.ws.clients || []) {
        ws.send(JSON.stringify(createAddMsg('entries', this.entries[hash])));
      }
      return () => {
        for (const ws of this.ws.clients || []) {
          ws.send(JSON.stringify(createDeleteMsg('entries', this.entries[hash])));
        }
        delete this.entries[hash];
      };
    },
    ws: plugin.router.ws('/server'),
  });
  plugin.web.ws.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify(createSyncMsg('entries', Object.values(plugin.web.entries))));
  });
});
plugin.required('koa', 'router', 'server');
export default plugin;
