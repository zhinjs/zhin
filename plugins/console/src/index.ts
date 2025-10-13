import {register, useContext} from '@zhin.js/core';
import react from '@vitejs/plugin-react';
import WebSocket,{WebSocketServer} from 'ws';
import {createServer,ViteDevServer,searchForWorkspaceRoot} from 'vite';
import connect from 'koa-connect';
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from "node:url";
import tailwindcss from '@tailwindcss/vite';

declare module '@zhin.js/types' {
    interface GlobalContext {
        web: WebServer;
    }
}
export type WebEntry=string|{
    production:string
    development:string
}
export type WebServer = {
    vite:ViteDevServer,
    addEntry(entry: WebEntry): () => void;
    entries: Record<string, string>;
    ws:WebSocketServer
};
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
useContext('router', async (router) => {
    const root = path.join(process.cwd(),'node_modules','@zhin.js','client','app');
    const base='/vite/'
    const vite = await createServer({
        root,
        base,
        plugins: [
            react(),
            tailwindcss(),
        ],
        server: {
            middlewareMode: true,
            fs: {
                allow: [searchForWorkspaceRoot(fileURLToPath(import.meta.url))],
            },
        },
        resolve: {
            dedupe: ['react', 'react-dom'],
            alias: {
                '@zhin.js/client': path.resolve(root, '../src'),
                'radix-ui':path.resolve(import.meta.dirname,'../node_modules/radix-ui'),
                "@radix-ui/themes":path.resolve(import.meta.dirname,'../node_modules/@radix-ui/themes'),
                "lucide-react":path.resolve(import.meta.dirname,'../node_modules/lucide-react'),
                '@': path.resolve(root, 'src'),
            },
        },
        optimizeDeps: {
            include: ['react', 'react-dom'],
        },
        build: {
            rollupOptions: {
                input: root + '/index.html',
            },
        },
    });
    
    // Vite 中间件 - 必须在其他路由之前
    router.use((ctx: any, next: any) => {
        if(ctx.request.originalUrl.startsWith('/api')) return next()
        return connect(vite.middlewares)(ctx,next);
    });
    
    // SPA 回退路由 - 处理所有未匹配的路由
    router.all('*all', async (ctx, next) => {
        const url = ctx.request.originalUrl.replace(base, '')
        const name = ctx.path.slice(1);
        
        const sendFile = (filename: string) => {
            ctx.type = path.extname(filename);
            if (filename.endsWith('.ts')) ctx.type = 'text/javascript';
            return (ctx.body = fs.createReadStream(filename));
        };
        
        // 1. 检查是否是动态入口
        if (Object.keys(webServer.entries).includes(name)) {
            return sendFile(path.resolve(process.cwd(), webServer.entries[name]));
        }
        
        // 2. 检查是否是静态文件
        const filename = path.resolve(root, name);
        if (filename.startsWith(root) || filename.includes('node_modules')) {
            if (fs.existsSync(filename)) {
                const fileState = fs.statSync(filename);
                if (fileState.isFile()) {
                    return sendFile(filename);
                }
            }
        } else {
            // 安全检查：路径不在允许范围内
            return (ctx.status = 403);
        }
        
        // 3. 所有其他路径（包括 SPA 路由）都返回 index.html
        // 这样前端路由可以正确处理
        const template = fs.readFileSync(path.resolve(root, 'index.html'), 'utf8');
        ctx.type = 'html';
        ctx.body = await vite.transformIndexHtml(url, template);
    });

    const webServer:WebServer={
        vite,
        entries: {},
        addEntry(entry) {
            const hash = Date.now().toString(16)+Math.random().toString(16).slice(2,8);
            const entryFile=typeof entry==="string"?entry:entry[(process.env.NODE_ENV as 'development'|'production')||'development'];
            this.entries[hash] = `/vite/@fs/${entryFile}`;
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
        ws:router.ws('/server')
    }
    // 数据推送函数
    const broadcastToAll = (message: any) => {
        for (const ws of webServer.ws.clients || []) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        }
    }

    // 推送数据更新通知
    const notifyDataUpdate = () => {
        broadcastToAll({
            type: 'data-update',
            timestamp: Date.now()
        });
    }

    // WebSocket 连接处理
    webServer.ws.on('connection', (ws: WebSocket) => {
        // 发送初始数据
        ws.send(JSON.stringify(createSyncMsg('entries', Object.values(webServer.entries))));

        // 通知客户端进行数据初始化
        ws.send(JSON.stringify({
            type: 'init-data',
            timestamp: Date.now()
        }));
        
        ws.on('close', () => {
        });
        
        ws.on('error', (error) => {
            // console.error 已替换为注释
        });
    });

    // 定时通知客户端更新数据
    const dataUpdateInterval = setInterval(() => {
        notifyDataUpdate();
    }, 5000); // 每5秒通知一次更新

    // 插件卸载时清理定时器
    process.on('exit', () => {
        clearInterval(dataUpdateInterval);
    });
    register({
        name:'web',
        description:"web服务",
        async mounted(){
            return webServer
        },
        async dispose(server){
            await server.vite.close();
            server.ws.close()
        }
    })

});
