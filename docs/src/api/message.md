# 消息定义

zhin中的消息分为普通文本消息、消息元素、消息模板和消息组件构成。

## 普通文本消息

普通文本消息是指不包含任何消息元素的字符串。你可以通过session.reply方法来发送普
通文本消息。

```typescript
session.reply("Hello World!");
```

## 消息元素

消息元素是指消息中的一些特殊元素，例如图片、链接、at等。你可以通过导入zhin提供
的`h`来构造，通过session.reply方法来发送消息元素。

```typescript
import { h } from "zhin";

session.reply(h("mention", { user_id: 123456789 })); // 提及某人
session.reply(h("image", { url: "https://example.com/image.png" })); // 发送图片
session.reply(h("face", { id: 123 })); // 发送表情
session.reply(h("rps", { id: 1 })); // 发送猜拳
session.reply(h("dice", { id: 1 })); // 发送骰子
session.reply(
  h("node", {
    message: ["Hello World!", h("mention", { user_id: 123456789 })],
  }),
); // 发送节点
```

## 消息模板

消息模板是一种特殊的文本消息，在其中你可以通过类html的方式来构造消息元素。你可以
通过session.reply方法来发送消息模板。

```typescript
session.reply(
  'Hello World!<face id="123"/><mention user_id="123456789"/><image url="https://example.com/image.png"/>',
);
```

## 消息组件

消息组件是由开发者自定义的消息元素，你可以通过ctx.component来注册消息组件，通过
session.reply方法来发送消息组件。

```typescript
import { defineComponent } from "zhin";

ctx.component(
  "my-component",
  defineComponent({
    props: {
      who: String,
    },
    render(props) {
      return `Hello ${props.who}!`;
    },
  }),
);
ctx.middleware((session, next) => {
  session.reply(`<my-component who="World"/>`);
  next();
});
```
