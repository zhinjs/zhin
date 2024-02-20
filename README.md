# zhin
## 1. 快速上手
- 安装 & 初始化
```shell
# 1. 安装依赖框架
yarn add zhin # or pnpm install zhin
# 2. 安装适配器(目前已支持qq官方机器人和icqq)
yarn add @zhinjs/qq # 如果你需要使用 icqq , 可安装 @zhinjs/icqq
# 2. 初始化配置文件
npx zhin init -m dev
```
- 填写配置
打开生成在根目录的 `bot.config.ts` 文件，填入相关环境变量
```typescript
import { defineConfig } from 'zhin';
import qqAdapter from '@zhinjs/qq'
// 更多适配器请访问官方文档
import * as path from 'path';

export default defineConfig(({ mode,zhinSecret,zhinDingTalkSecret,zhinDiscordSecret }) => {
  return {
    logLevel:'info',
    adapters:[
      qqAdapter
    ],
    bots:[
      {
        adapter:'qq', // 使用qq适配器
        appid:'123456789', // qq机器人appId
        secret:'asdflkjasiodf', // qq机器人secret
        group:true, // 是否支持群聊
        private: true, // 是否支持私聊
        public:true // 是否公域机器人
      },
    ],
    pluginDirs:[
      path.resolve(__dirname,'plugins') // 本地插件文件夹路径
    ],
    plugins: [
      'commandParser', // 指令解析插件
      mode === 'dev' && 'hmr', // 开发环境热更插件
      "setup", // setup语法支持插件
      // ... 你自己的的插件
    ].filter(Boolean),
  };
})
```
- 目前已内置有 `commandParser`、`hmr`、`echo`、`pluginManager` 四个插件，其他插件请关注官方仓库和社区插件


- 启动
- 注意：首次启动会为你生成对应适配器的默认配置文件，需要您完成配置后再次启动
```text
npx zhin -m dev
```
