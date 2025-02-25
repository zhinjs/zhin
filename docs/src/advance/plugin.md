# 插件
- 在知音的设计理念中，插件是实现一切业务逻辑的载体，小到指令定义，大到服务定义、中间件定义，都可以通过插件来实现。插件是知音的核心，也是知音的灵魂。
- 知音同时支持使用 `javascript` 和 `typescript` 进行插件开发，开发者可以根据自己的喜好选择开发语言。
- 插件分为 `本地插件` 和` 模块插件`。
- 无论是本地插件还是模块插件，都需要在 `zhin.config.yml` 中配置启用才能生效。
## 本地插件
- 本地插件是指在本地开发的插件，可以是一个普通的 `js` 或 `ts` 文件，也可以是一个目录，目录下包含一个 `index.js` 或 `index.ts` 文件，或者通过 `package.json` 管理的插件包。

## 模块插件
- 模块插件是指通过 `npm` 发布的插件，可以通过 `npm` 安装到项目中。
## 插件开发
### 1. 创建插件
- 在项目的 `plugins` 目录下创建一个插件目录，插件目录下创建一个 `index.js` 或 `index.ts` 文件。
- 也可以通过 `npm init` 创建一个插件包。
- 一个插件的目录结构如下：
```text
plugins
└── my-plugin
    ├── index.js
    └── package.json
```
### 2. 编写插件
- 知音通过实例化 `Plugin` 类来创建一个插件。
- 通过实例化对象 你可以往插件实例上挂载指令、服务、中间件等。
- 你可以通过 `mounted` 声明周期，指定插件挂载时的操作。
- 你需要将实例化对象作为默认导出，zhin才会视为有效插件。
- 一个简单的插件示例：
::: code-group

```javascript [index.js]
import { Plugin } from 'zhin';
const plugin = new Plugin('my-plugin');
// 定义指令
plugin.command('hello', 'hello world');
// 定义服务
plugin.service('foo',{
    async bar(){
        return 'bar';
    }
})
// 定义中间件
plugin.middleware(async (message, next) => {
    console.log('before');
    await next();
});
// 挂载周期
plugin.mounted(() => {
  console.log('my-plugin is mounted');
  // 使用服务
  console.log(plugin.hello.bar()) // bar 
});
export default plugin;
```
```json [package.json]
{
  "name": "my-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "peerDependencies": {
    "zhin": "latest"
  }
}
```
:::
### 3. 启用插件
- 在 `zhin.config.yml` 中的 `plugins` 下添加插件名称即可启用插件。
```yaml
plugins:
  - my-plugin
```
### 4. 插件发布
- 如果你的插件是一个模块插件，你可以通过 `npm publish` 发布到 `npm` 上。
- 其他开发者可以通过 `npm install my-plugin` 安装你的插件。
## 更多
- 本篇章节只是简单介绍了插件的基本使用，更多插件实例方法，请参考当前页面左侧 `核心模块` 功能介绍。

