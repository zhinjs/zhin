# 可交互输入(Prompt)

## 引言

在实际开发过程中，我们可能会需要用户输入必填参数，或者需要用户确认操作，才能继续执行函数，
为此，zhin在**会话(Session)**上提供了一个`prompt`对象，用于接收用户下一次输入的内容，具体用例如下：

## 案例

```typescript
import {Context} from "zhin";

export function install(ctx: Context) {
    ctx.command('del [id:number]')
        .desc('删除用户')
        .action(async ({session}, id) => {
            if (!id) id = await session.prompt.number('请输入你要删除的用户ID')
            const confirm = await session.prompt.confirm(`确认删除用户(${id})么？`)
            if (confirm) {
                // 删除用户
                return '删除成功'
            }
            return '已取消'
        })
}
```

<ChatHistory>
  <ChatMsg id="1659488338">del</ChatMsg>
  <ChatMsg id="1689919782">请输入你要删除的用户ID</ChatMsg>
  <ChatMsg id="1659488338">78</ChatMsg>
  <ChatMsg id="1689919782">确认删除用户(78)么？<br/>输入yes,y,Yes,YES,Y,.,。,确认为确认</ChatMsg>
  <ChatMsg id="1659488338">yes</ChatMsg>
  <ChatMsg id="1689919782">删除成功</ChatMsg>
</ChatHistory>

当然，prompt可以支持的交互不仅与number和confirm，下面将详细介绍有那些交互输入的类型

## 可交互输入的类型

### 1.text

- 输出一条提示信息，提示用户输入一行文本

```typescript
const name = session.prompt.text('请输入姓名')
```

### 2.number

- 输出一条提示信息，提示用户输入一个数字

```typescript
const age = session.prompt.number('请输入年龄')
```

### 3.date

- 输入一条提示信息，提示用户输入一个日期

```typescript
const birthDay = session.prompt.date('请输入出生年月日')
```

### 4.regexp

- 输入一条提示信息，提示用户输入一个正则表达式

```typescript
const reg = session.prompt.regexp('请输入一个正则表达式')
```

### 5.confirm

- 输入一条提示信息，提示用户是否确认

```typescript
const isAdult = session.prompt.confirm('是否成年')
```

### 6.list

- 输入一条提示信息，提示用户输入一个指定类型的list

```typescript
const hobbies = session.prompt.list('请输入你的兴趣爱好', {child_type: 'text'})
```

### 7.select

- 输入一条提示信息，提示用户选择一个或多个给出选项的值

```typescript
const selctedList = session.prompt.select('请选择你喜欢的水果', {
    child_type: 'text',
    multiple: true,// 不传则为单选
    options: [
        {label: '苹果', value: 'apple'},
        {label: '香蕉', value: 'banana'},
        {label: '橙子', value: 'orange'},
    ]
})
```

### 8.组合成对象使用(prompts)

除了上述单条单条的让用户输入，zhin还允许，你将配置组合成一个对象，让用户依次输入，最后组装成一个对象返回。

我们将上述7个例子组装在一起后，试试效果

```typescript

import {Context} from "zhin";

export function install(ctx: Context) {
    ctx.command('collect')
        .desc('采集用户信息')
        .action(async ({session}, id) => {
            const userInfo = await session.prompt.prompts({
                name: {type: 'text', message: '请输入姓名'},
                age: {type: 'number', message: '请输入年龄'},
                birthDay: {type: 'date', message: '请输入出生年月日'},
                reg: {type: 'regexp', message: '请输入一个正则表达式'},
                isAdult: {type: 'confirm', message: '是否成年'},
                hobbies: {type: 'list', child_type: 'text', message: '请输入你的兴趣爱好'},
                likeFruits: {
                    type: 'select', child_type: 'text', message: '请选择你喜欢的水果',multiple:true, options: [
                        {label: '苹果', value: 'apple'},
                        {label: '香蕉', value: 'banana'},
                        {label: '橙子', value: 'orange'},
                    ]
                }
            })
            return JSON.stringify(userInfo,null,2)
        })
}
```

<ChatHistory>
  <ChatMsg id="1659488338">collect</ChatMsg>
  <ChatMsg id="1689919782">请输入姓名</ChatMsg>
  <ChatMsg id="1659488338">张三</ChatMsg>
  <ChatMsg id="1689919782">请输入年龄</ChatMsg>
  <ChatMsg id="1659488338">18</ChatMsg>
  <ChatMsg id="1689919782">请输入出生年月日</ChatMsg>
  <ChatMsg id="1659488338">2000-01-01</ChatMsg>
  <ChatMsg id="1689919782">请输入一个正则表达式</ChatMsg>
  <ChatMsg id="1659488338">/^(.*)$/</ChatMsg>
  <ChatMsg id="1689919782">是否成年<br/>输入yes,y,Yes,YES,Y,.,。,确认为确认</ChatMsg>
  <ChatMsg id="1659488338">y</ChatMsg>
  <ChatMsg id="1689919782">请输入你的兴趣爱好<br/>值之间使用','分隔</ChatMsg>
  <ChatMsg id="1659488338">唱,跳,Rap,篮球</ChatMsg>
  <ChatMsg id="1689919782">请选择你喜欢的水果<br/>1.苹果<br/>2.香蕉<br/>3.橙子<br/>值之间使用','分隔</ChatMsg>
  <ChatMsg id="1659488338">1</ChatMsg>
  <ChatMsg id="1689919782">{
  "name": "张三",
  "age": 18,
  "birthDay": "2000-01-01T00:00:00.000Z",
  "reg": {},
  "isAdult": true,
  "hobbies": [
    "唱",
    "跳",
    "Rap",
    "篮球"
  ],
  "likeFruits": [
    "apple"
  ]
}
  </ChatMsg>
</ChatHistory>