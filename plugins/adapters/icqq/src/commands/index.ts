/**
 * ICQQ 命令注册 — 通过 IPC 调用守护进程
 */
import { MessageCommand } from "zhin.js";
import type { IcqqAdapter } from "../adapter.js";
import { Actions } from "../protocol.js";

export function registerCommands(
  addCommand: (cmd: MessageCommand<"icqq">) => void,
  icqq: IcqqAdapter,
) {
  addCommand(
    new MessageCommand<"icqq">("赞我 <times:number>")
      .permit("adapter(icqq)")
      .action(async (message, result) => {
        const bot = icqq.bots.get(message.$bot);
        if (!bot) return "Bot 不在线";
        const userId = Number(message.$sender.id);
        // 每次最多 20 赞，分三次请求共 50 赞
        const results = await Promise.all([
          bot.ipc.request(Actions.FRIEND_LIKE, { user_id: userId, times: 20 }),
          bot.ipc.request(Actions.FRIEND_LIKE, { user_id: userId, times: 20 }),
          bot.ipc.request(Actions.FRIEND_LIKE, { user_id: userId, times: 10 }),
        ]);
        let times = 0;
        if (results[0].ok) times += 20;
        if (results[1].ok) times += 20;
        if (results[2].ok) times += 10;
        return `给你赞好啦，你已经获得了${times}个赞`;
      }),
  );
}
