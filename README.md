# zhin
基于oicq的简约机器人框架
## 快速上手

1.安装依赖
```shell
npm install zhin
```
2.创建入口文件

index.js
```javascript
const {createWorker}=require('zhin')
createWorker()

```
4.执行入口文件
```shell
node ./index.js
```
- 首次执行，会自动生成配置文件，需要您自行配置后再次重启方可正常启动
## 插件热更配置
- zhin内置插件热更替的插件，你只需要简单配置，即可在开发时，无需重启整个项目，热更插件
1. 在配置文件中的plugins中添加`watcher`选项，声明使用watcher插件，其值为需要监听的目录地址，默认为运行目录下的`plugins`文件夹

## 编写插件
1. 定义插件目录
- 在配置文件增加plugin_dir项，并将值设为你插件所在的目录路径(此处举例为：
  plugins)
2. 在你定义插件目录下新建一个插件文件(此处举例为：hello.js)，并编写插件逻辑
- 举例代码：

hello.js
```javascript
module.exports={
    name:'hello',
    install(bot){
        bot.command('hello','all')
            .action(()=>'world')
    }
}
```
3. 在配置文件中声明使用的插件
- 配置文件中的plugins项中添加`hello`，下次启动项目时，会自动加载刚刚定义的插件
## 了解更多
- 至此，你应该能使项目正常跑起来了，但更多的API使用方法，需要你访问 [本仓库](https://github.com/liucl-cn/zhin) 查看源代码了解更多