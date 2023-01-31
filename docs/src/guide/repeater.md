::: info
通过本节的阅读，你将了解到如何新建一个插件、使用zhin提供的api实现一些简单的小功能，以及插件的发布
:::
# 写个复读🐔
## 1. 创建插件
- 你可以使用`zhin new [pluginName]`创建插件
在项目根目录下打开命令提示符窗口，执行以下命令
```shell
zhin new repeater # 此处repeater为插件名
# or
zhin new repeater -t # 如果你想使用TS进行开发，可增加`-t`选项，声明需要创建TS插件
```
命令执行完成后，会在项目的插件目录下新增一个repeater文件夹，其中已经自动产生了一个名为`index.js`(TS则为`src/index.ts`)`的文件,内容如下：

::: code-group
```js [index.js]
module.exports={
    name:'repeater',
    install(ctx){
        // 在这儿实现你的插件逻辑
        // 功能样例：
        // 1.定义指令
        /*
        ctx.command('test')
            .option('foo','-f <bar:string>')
            .action(({session,options})=>{
                console.log('options',options);
                return 'hello world'
            })
        */
        // 2.定义中间件
        /*
        ctx.middleware(async (session,next)=>{
            if(true){ //需要判断的条件
            //逻辑执行代码
            }else{
                next() // 不next，则不会流入下一个中间件
            }
        });
        */
        // 3. 监听事件
        /*
        ctx.on(eventName,callback);
        ctx.once(eventName,callback);
        ctx.on(eventName,callback);
        */
        // 4. 定义服务
        /*
        ctx.service('serviceName'，{}) // 往bot上添加可全局访问的属性
        */
        // 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
        // 如果不需要，可以不return
        /*
        return ()=>{
            // 如果你使用过react的useEffect 那你应该知道这是在干嘛
            // 函数内容将会在插件卸载时自动卸载
        }
        */
    }
}
```
```ts [src/index.ts]
import {Context} from 'zhin';
export const name='repeater';
export function install (ctx:Context){
    // 在这儿实现你的插件逻辑
    // 功能样例：
    //1.定义指令
    /*
    ctx.command('test')
        .option('foo','-f <bar:string>')
        .action(({session,options})=>{
            console.log('options',options);
            return 'hello world'
        })
    */
    // 2.定义中间件
    /*
    ctx.middleware(async (session,next)=>{
        if(true){ //需要判断的条件
        //逻辑执行代码
        }else{
            next() // 不next，则不会流入下一个中间件
        }
    });
    */
    // 3. 监听事件
    /*
    ctx.on(eventName,callback);
    ctx.once(eventName,callback);
    ctx.on(eventName,callback);
    */
    // 4. 定义服务
    /*
    ctx.service('serviceName'，{}) // 往bot上添加可全局访问的属性
    */
    // 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
    // 如果不需要，可以不return
    /*
    return ()=>{
        // 如果你使用过react的useEffect 那你应该知道这是在干嘛
        // 函数内容将会在插件卸载时自动卸载
    }
    */
}
```
:::
内容中注释了很多示例代码，可让你快速了解zhin的api功能
## 2. 编写插件逻辑
现在，让我们做些更改，实现一个复读机插件
::: code-group
```js [index.js]
module.exports={
    name:'repeater',
    install(ctx){
        ctx.middleware(async (session,next)=>{
            await session.reply(session.message)
            next()
        });
    }
}
```
```ts [src/index.ts]
import {Context} from 'zhin';
export const name='repeater';
export function install (ctx:Context){
    ctx.middleware(async (session,next)=>{
        await session.reply(session.message)
        next()
    });
}
```
:::
现在，一个简单的复读机就写好了，接下来，我们启用刚刚编写的插件
## 3.启用插件
在配置文件`zhin.yaml`中声明该插件，zhin则会自动载入该插件
```yaml [zhin.yaml]
adapters: 
  icqq: # 指定使用icqq适配器
    bots:
      - uin: 147258369 # 登录的账号
        platform: 5 # 指定qq登录平台为iPad（1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板）
plugins:
  config: null # 指定启用配置管理插件
  daemon: null # 指定启用守护进程插件
  help: null # 指定启用帮助插件
  login: null # 指定启用命令行登录插件
  logs: null # 指定启用日志插件
  plugin: null # 指定启用插件管理插件
  status: null # 指定启用状态查看插件
  watcher: plugins # 指定启用文件监听插件
  repeater: null # 指定启用复读机插件 // [!code ++]
log_level: info # 指定日志等级
plugin_dir: plugins # 指定本地插件存放目录
data_dir: data # 缓存文件存放目录
delay:
  prompt: 60000 # prompt方法超时时间为1分钟(60*1000毫秒)
```
## 4.编译插件 (可选)
::: tip
在发布插件前，若你使用TS开发插件，推荐先编译为JS可用的插件。否则，该插件将不能在JS环境下执行
:::
- 你可以使用指令`zhin build [pluginName]`编译TS开发的插件为JS插件
- 现在，执行以下命令，将TS插件编译为JS插件吧
```shell
zhin build repeater
```
## 5.发布插件
- 在插件开发完成后，若你有意愿公开你的插件，你可使用`zhin pub [pluginName]`发布本地指定插件名的插件到`npmjs`供他人使用
::: info
若插件名与`npmjs`已有包冲突，将无法发布，可尝试修改插件名，重新发布
:::
- 现在，执行以下命令，将发布你的第一个zhin插件到`npmjs`吧
```shell
zhin pub repeater
```
