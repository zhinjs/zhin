import {
  usePlugin,
  MessageCommand,
} from "zhin.js";
import {
  collectZtFallbackData,
  collectZtReportData,
  ztReportReply,
} from "./zt-report.js";

const plugin = usePlugin();
const { addCommand, addComponent, root } = plugin;
const Test=async function Test(){
  return new Promise<string>((resolve,reject)=>{
    setTimeout(() => {
      reject(new Error("测试异步组件错误处理"));
    }, 1000);
    setTimeout(() => {
      resolve("如果你看到这条消息，说明异步组件没有正确处理错误。");
    }, 2000);
  })
}
addComponent(Test);
addCommand(
  new MessageCommand("test-err").action(async () => {
    return <Test/>;
  })
);

addCommand(
  new MessageCommand("zt")
    .desc("查看系统状态", "以 Satori 渲染卡片图展示主机、CPU、内存与 Bot 运行状态")
    .usage("zt")
    .examples("zt")
    .action(async () => {
      let data;
      try {
        data = collectZtReportData(root);
      } catch (err) {
        plugin.logger.warn(
          `zt: @puniyu/system-info failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        data = collectZtFallbackData(root);
      }
      return ztReportReply(data);
    })
);
