# 指令(Command)
## 引言
- 指令是当一条消息满足一定条件时，约定机器人执行指定一个函数函数
- 在大多数机器人中，都是这样实现这个功能的
```js
// ...
bot.on('message',(event)=>{
    if(event.raw_message==='foo'){
        // 执行foo函数
        foo()
    }else if(event.raw_message.startsWith('bar')){
        event.raw_message=event.raw_message.replace('bar','')
        // 根据参数执行bar函数
        bar(...event.raw_message.split(' '))
        // do sth
    }else if(condition){
        // ...
    } // ...
})
```
- 这无疑是及其混乱的，而且还不利于维护。
- 为此，zhin参考市面上的指令实现后，实现了自己的指令系统
- 上边的代码在zhin中，可以这么优雅的实现
```ts [src/index.ts]
// ...
export function install (ctx:Context){
    ctx.command('foo')
        .action(foo)
    ctx.command('bar <...args>')
        .action((argv,...args)=>bar(...args))
}
```

如此定义后：zhin会在用户发送的消息为`foo`时，自动执行**foo函数**
当用户发送的消息为`bar`开头时，zhin自动执行**bar函数**，并将后续的参数按**空格**分隔，传递给**bar函数**

并且还有更多的使用方式，让我们接着往下看...
## 参数定义
如你所见，使用 ctx.command(desc) 方法可以定义一个指令，其中 desc 是一个字符串，包含了**指令名**和**参数列表**。
- 指令名可以包含数字、字母、下划线、短横线甚至中文字符，但不应该包含空格、小数点 `.` 或斜杠 `/`
- 一个指令可以含有任意个参数。其中 **必选参数** 用**尖括号**包裹，**可选参数** 用**方括号**包裹
- 有时我们需要传入未知数量的参数，这时我们可以使用 **变长参数**，它可以通过在括号中前置**...**来实现。如：
```ts
ctx.command('echo <arg1> [...rest]')
  .action((_, arg1, ...rest) => { /* do something */ })
```
上面一行代码声明了一个`echo`指令，并且该指令接收**1到多个参数**
### 参数类型
知音默认参数类型为消息段，若你需要指定类型，仅需在参数名后跟上`:type`即可，zhin内置的数据类型有：
- string: string 字符串
- integer: number 整数
- number: number 数值
- boolean: boolean 布尔值
- user_id: number | string 用户id
- regexp: RegExp 正则表达式
- date: Date 日期
- json: Dict | List JSON对象
- function: Function 函数
用例：
```ts
ctx.command('send <arg1:face> [...rest:number]') // 声明第一个参数为一个表情，剩下的参数均为数值
```
上面一行代码声明了一个`send`指令，并且该指令接收**一个表情**和**多个数值**,作为参数
## 可选项定义
使用 cmd.option(name, desc) 函数可以给指令定义参数。这个函数也是可以链式调用的，例如：
```ts
ctx.command('music <keyword:string>')
  .option('-o [origin:boolean]')          // 是否原声输出
  .option('-p <platform:string>')    // 选用音乐平台
  .option('-s [singer:number]')  // 指定歌手id
  .action(({ options },keyword) => JSON.stringify(options))
```

<ChatHistory>
  <ChatMsg id="1659488338">music 烟雨行舟 -o -p qq -s 82329</ChatMsg>
  <ChatMsg id="1689919782">{"options":true,"platform":"qq","singer":82329}</ChatMsg>
</ChatHistory>


同样，可选项的参数也可以声明类型，声明方式同上
## 快捷方式
zhin的指令机制虽然能够尽可能避免冲突和误触发，但是也带来了一些麻烦。一方面，一些常用指令的调用会受到指令前缀的限制；另一方面，一些指令可能有较长的选项和参数，但它们调用时却往往是相同的。面对这些情况，**快捷方式 (Shortcut)** 能有效地解决你的问题
接下来
我们将刚刚上边的`music`指令稍微进行一下改造
```ts
ctx.command('music <keyword:string>')
    .option('-o [origin:boolean]')    // 是否原声输出
    .option('-p <platform:string>')    // 选用音乐平台
    .option('-s [singer:number]')  // 指定歌手id
    .sugar('qq点歌',{options:{platform:'qq',origin:true}}) // [!code ++]
    .action(({ options },keyword) => JSON.stringify(options))
```
- 这儿的`fuzzy`标识指令可以带参数

<ChatHistory>
  <ChatMsg id="1659488338">qq点歌 烟雨行舟</ChatMsg>
  <ChatMsg id="1689919782">{"options":true,"platform":"qq"}</ChatMsg>
</ChatHistory>

除此以外，你还可以使用正则表达式作为快捷方式：
```ts
ctx.command('music <keyword:string>')
    .option('-o [origin:boolean]')    // 是否原声输出
    .option('-p <platform:string>')    // 选用音乐平台
    .option('-s [singer:number]')  // 指定歌手id
    .sugar('qq点歌',{options:{platform:'qq',origin:true}})
    .sugar(/^来一首(.+)$/,{args:['$1'],options:{platform:'qq',origin:true}}) // [!code ++]
    .action(({ options },keyword) => [keyword,JSON.stringify(options)])
```
这样一来，输入**来一首烟雨行舟**就等价于输入`music 烟雨行舟 -p qq -o`了。

不难看出，使用快捷方式会让你的输入方式更加接近自然语言，也会让你的机器人显得更平易近人。
