import {
  useContext,
  addCommand,
  usePrompt,
  Time,
  addComponent,
  defineComponent,
  MessageCommand,
  useApp,
  Adapter,
  onDatabaseReady,
  defineModel,
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
const app = useApp();
function formatMemoSize(size: number) {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  while (size > 1024) {
    size = size / 1024;
    sizes.shift();
  }
  return `${size.toFixed(2)}${sizes[0]}`;
}
addCommand(new MessageCommand("send").action((_, result) => result.remaining));
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
      `运行环境：NodeJS ${process.version}`,
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

const testComponent = defineComponent({
  name: "test",
  props: {
    id: String,
  },
  async render({ id }, context) {
    return "这是父组件" + id + (context.children || "");
  },
});
const testComponent2 = defineComponent({
  name: "fetch",
  props: {
    url: {
      type: String,
      default: "",
    },
  },
  async render({ url }) {
    const result: string = await fetch(url).then((r) => r.text());
    return result;
  },
});
addComponent(testComponent);
addComponent(testComponent2);
useContext("web", (web) => {
  web.addEntry(
    path.resolve(path.resolve(import.meta.dirname, "../../client/index.ts"))
  );
});
// 依赖icqq上下文
useContext("icqq", (p) => {
  // 指定某个上下文就绪时，需要做的事
  const someUsers = new MessageCommand("赞[space][...atUsers:at]", { at: "qq" })
    .scope("icqq")
    .action(async (m, { params }) => {
      if (!params.atUsers?.length) params.atUsers = [+m.$sender.id];
      const likeResult: string[] = [];
      for (const user_id of params.atUsers) {
        const userResult = await Promise.all(
          new Array(3).fill(0).map(() => {
            return p.bots.get(m.$bot)?.sendLike(user_id, 20);
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
});
const testCommand = new MessageCommand("test").action(async (m) =>
  usePrompt(m).text("请输入文本")
);
addCommand(testCommand);
defineModel("test_model",{
  name: { type: "text", nullable: false },
  age: { type: "integer", default: 0 },
  info: { type: "json" },
} );
onDatabaseReady(async (db) => {
    const model=db.model("test_model")
    // await model.create({
    //   name:'张三',
    //   age:20,
    //   info:{}
    // });
    // await model.delete({name:'张三'});
    const result=await model.select();
    console.log(result)
});
