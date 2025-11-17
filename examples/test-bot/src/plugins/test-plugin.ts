import {
  useContext,
  addCommand,
  Time,
  addComponent,
  MessageCommand,
  useApp,
  Adapter,
  onDatabaseReady,
  defineModel,
  MessageElement,
  ComponentContext,
  onMessage,
} from "zhin.js";
import path from "node:path";
import * as os from "node:os";

declare module "@zhin.js/types" {
  interface Models {
    test_model: {
      name: string;
      age: number;
      info: object;
    };
  }
}
const app = useApp()
const isBun=typeof Bun!=='undefined'
function formatMemoSize(size: number) {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  while (size > 1024) {
    size = size / 1024;
    sizes.shift();
  }
  return `${size.toFixed(2)}${sizes[0]}`;
}
addCommand(
  new MessageCommand("send").action(
    (_, result) => result.remaining as MessageElement[]
  )
);
addCommand(
  new MessageCommand("zt").action(() => {
    const totalmem = os.totalmem();
    const freemem = os.freemem();
    const usedmemo = totalmem - freemem;
    return [
      "-------概览-------",
      `操作系统：${os.type()} ${os.release()} ${os.arch()}`,
      `内存占用：${formatMemoSize(usedmemo)}/${formatMemoSize(totalmem)} ${(
        (usedmemo / totalmem) *
        100
      ).toFixed(2)}%`,
      // bun or tsx
      `运行环境：NodeJS ${process.version} ${isBun ? "Bun" : "TSX"}`,
      `运行时长：${Time.formatTime(process.uptime() * 1000)}`,
      `内存使用：${formatMemoSize(process.memoryUsage.rss())}`,
      "-------框架-------",
      `适配器：${app.adapters.length}个`,
      `插件：${app.dependencyList.length}个`,
      "-------机器人-------",
      ...app.adapters.map((name) => {
        return `  ${name}：${app.getContext<Adapter>(name).bots.size}个`;
      }),
    ].join("\n");
  })
);
addCommand(new MessageCommand("我才是[...content:text]")
.action(async (m, { params }) => {
  return `好好好，你是${params.content.join(" ").replace(/[你|我]/g, (match:string) => {
    return match === "你" ? "我" : "你"
  })}`;
}));
addComponent(async function foo(
  props: { face: number },
  context: ComponentContext
) {
  return "这是父组件" + props.face;
});
const randomUUID = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
console.log("测试插件加载完成，唯一标识：" + randomUUID());

useContext("web", (web) => {
  const dispose = web.addEntry({
    development: path.resolve(
      path.resolve(import.meta.dirname, "../../client/index.tsx")
    ),
    production: path.resolve(
      path.resolve(import.meta.dirname, "../../dist/index.js")
    ),
  });
  return dispose;
})
// 依赖icqq上下文
useContext("icqq", (p) => {
  // 指定某个上下文就绪时，需要做的事
  const someUsers = new MessageCommand<"icqq">("赞[space][...atUsers:at]", {
    at: "qq",
  })
    .permit("adapter(icqq)")
    .action(async (m, { params }) => {
      if (!params.atUsers?.length) params.atUsers = [+m.$sender.id];
      const likeResult: string[] = [];
      for (const user_id of params.atUsers) {
        const userResult = await Promise.all(
          new Array(5).fill(0).map(() => {
            return p.bots.get(m.$bot)?.sendLike(user_id, 10);
          })
        );
        likeResult.push(
          `为用户(${user_id})赞${
            userResult.filter(Boolean).length ? "成功" : "失败"
          }`
        );
      }
      return likeResult.join("\n");
    });
  addCommand(someUsers);
  // onMessage(async (m) => {
  //   if(m.$adapter==='process'){
  //     const b=p.bots.get('1689919782')
  //     if(b){
  //       b.$sendMessage({
  //         id:'860669870',
  //         type:'group',
  //         content:m.$content,
  //         context:'icqq',
  //         bot:'1689919782'
  //       })
  //     }
  //   }
  // });
});
defineModel("test_model", {
  name: { type: "text", nullable: false },
  age: { type: "integer", default: 0 },
  info: { type: "json" },
});
onDatabaseReady(async (db) => {
  const model = db.model("test_model");
  await model.delete({name:'张三'});
  // await model.create({
  //   name:'张三',
  //   age:20,
  //   info:{}
  // });
  // await model.delete({name:'张三'});
  const result = await model.select();
  console.log(result);
});
