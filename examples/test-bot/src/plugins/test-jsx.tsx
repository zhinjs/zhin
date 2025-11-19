import {
  addCommand,
  MessageCommand,
  addComponent,
} from "zhin.js";
const TestError=async function TestError(){
  return new Promise<string>((resolve,reject)=>{
    setTimeout(() => {
      reject(new Error("测试异步组件错误处理"));
    }, 1000);
    setTimeout(() => {
      resolve("如果你看到这条消息，说明异步组件没有正确处理错误。");
    }, 2000);
  })
}
addComponent(TestError);
addCommand(
  new MessageCommand("test-error").action(async (message, result) => {
    return <TestError />;
  })
);
