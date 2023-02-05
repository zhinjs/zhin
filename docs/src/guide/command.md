# 指令
- 作为机器人最基本的功能，zhin参考了众多指令系统的实现，最终实现了如今zhin的指令系统
- 从[上一节](/guide/repeater)的初始代码中，有着这么一段代码：
```ts [src/index.ts]
// ...
export function install (ctx:Context){
    // ...
    ctx.command('test')
        .option('foo','-f <bar:string>')
        .action(({session,options})=>{
            console.log('options',options);
            return 'hello world'
        })
    // ...
}
```
现在，我们来稍作更改，实现一个简单的 echo 指令：
```ts
// ...
export const name='repeater' // [!code --]
export const name='echo' // [!code ++]
export function install (ctx:Context){
    ctx.command('test') // [!code --]
    ctx.command('echo <message>') // [!code ++]
        .option('foo','-f <bar:string>')  // [!code --]
        .action(({session,options})=>{  // [!code --]
        .action((argv,message)=>{  // [!code ++]
            console.log('options',options);  // [!code --]
            return 'hello world'  // [!code --]
            return message  // [!code ++]
        })
}
```
现在，我们的代码应该是这样
```ts
export const name='echo'
export function install (ctx:Context){
    ctx.command('echo <message>')
        .action((argv,message)=>{
            return message
        })
}
```
就是这么几行代码，我们就实现了一个echo指令，现在，我们来回顾下，这段代码是如何工作的：
- `.command()`方法定义了一个 echo 指令，其有一个必选参数为 message
- `.action()`方法定义了指令触发时的回调函数，第一个参数是一个 Argv 对象，第二个参数是输入的 message

这种链式的结构能够让我们非常方便地定义和扩展指令。稍后我们将看到这两个函数的更多用法，以及更多指令相关的函数。
## 参数定义
如你所见，使用 ctx.command(desc) 方法可以定义一个指令，其中 desc 是一个字符串，包含了**指令名**和**参数列表**。
- 指令名可以包含数字、字母、下划线、短横线甚至中文字符，但不应该包含空格、小数点 `.` 或斜杠 `/`
- 一个指令可以含有任意个参数。其中 **必选参数** 用尖括号包裹，**可选参数** 用方括号包裹
- 有时我们需要传入未知数量的参数，这时我们可以使用 **变长参数**，它可以通过在括号中前置 ... 来实现。如：
```ts
ctx.command('my-command <arg1> [...rest]')
  .action((_, arg1, ...rest) => { /* do something */ })
```
### 参数类型
知音默认参数类型为消息段，若你需要指定类型，仅需在参数名后跟上`:type`即可，zhin内置的数据类型有：
- text： 长文本，可带通过
- string： 普通文本，不可带空格
- mention： 一个At消息段
- face： 一个表情
- voice： 一段音频
- audio： 一条语音
- image： 一张图片
- number： 数值类型
- boolean： 布尔值
- integer： 整数
- date： 日期
- regexp： 正则
用例：
```ts
ctx.command('my-command <arg1:face> [...rest:number]') // 声明第一个参数为一个表情，剩下的参数均为数值
```
## 可选项定义
使用 cmd.option(name, desc) 函数可以给指令定义参数。这个函数也是可以链式调用的，例如：
```ts
ctx.command('my-command')
  .option('alpha', '-a')          // 定义一个选项
  .option('beta', '-b [beta]')    // 定义一个带参数的可选选项
  .option('gamma', '-c <gamma>')  // 定义一个带参数的必选选项
  .action(({ options }) => JSON.stringify(options))
```
同样，可选项的参数也可以声明类型，声明方式同上
## 快捷方式
zhin的指令机制虽然能够尽可能避免冲突和误触发，但是也带来了一些麻烦。一方面，一些常用指令的调用会受到指令前缀的限制；另一方面，一些指令可能有较长的选项和参数，但它们调用时却往往是相同的。面对这些情况，`快捷方式 (Shortcut)` 能有效地解决你的问题

假设你实现了一个货币系统和 rank 指令，调用 rank wealth --global 可以实现查看全服所有人财富排行，你可以这样做：
```ts
ctx.command('rank <type>')
  .shortcut('全服财富排行', { args: ['wealth'], options: { global: true } })
```
这样一来，只要输入“全服财富排行”，Koishi 就会自动调用 rank wealth --global，回复查询结果了。

通常来说，快捷方式都要求严格匹配（当然删除两端空格和繁简体转化这种程度的模糊匹配是可以做的），但是你也可以让快捷方式允许带参数：
```ts
ctx.command('buy <item>')
  .shortcut('购买', { prefix: true, fuzzy: true })
```
上面程序注册了一个快捷方式，prefix 要求在调用时保留指令前缀，而 fuzzy 允许这个快捷方式带参数列表。这样一来，只要输入“Koishi，购买物品名”，Koishi 就会自动调用“buy 物品名”了。

除此以外，你还可以使用正则表达式作为快捷方式：
```ts
ctx.command('market <area>')
  .shortcut(/^查(.+区)市场$/, { args: ['$1'] })
```
这样一来，输入“查美区市场”就等价于输入“market 美区”了。

不难看出，使用快捷方式会让你的输入方式更加接近自然语言，也会让你的机器人显得更平易近人。
