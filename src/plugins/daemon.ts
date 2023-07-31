import { useContext, Schema, useOptions, Bot, Zhin, NSession } from "@";
import { promisify } from "util";
import { exec } from "child_process";

export const name = "systemDaemon";
const ctx = useContext();
const config = useOptions("plugins.daemon");
const Config = Schema.object({
    exitCommand: Schema.union([
        Schema.boolean().default(true).description("是否添加退出指令"),
        Schema.string().default("添加的指令"),
    ]),
    autoRestart: Schema.boolean().default(true).description("是否自动重启"),
});
const { exitCommand = true, autoRestart = true } = Config(config);

function handleSignal(signal: NodeJS.Signals) {
    ctx.zhin.logger.info(`terminated by ${signal}`);
    process.exit();
}

interface Message {
    type: "send";
    body: any;
    times?: number;
}

const promiseExec = promisify(exec);
const changeDependency = async (name: string) => {
    const { stderr } = await promiseExec(`npm install ${name} --force`, { cwd: process.cwd() });
    if (stderr) {
        if (/npm ERR/i.test(stderr)) {
            return [false, stderr];
        }
    }
    return [true, ""];
};
ctx.master()
    .command("update")
    .desc("升级zhin")
    .option("-v [version:string] 指定版本，默认最新版")
    .option("-r [restart:boolean] 更新完重启")
    .hidden()
    .action<NSession<keyof Zhin.Adapters>>(async ({ options, session }) => {
        if (!options.version) {
            options.version = await ctx.request
                .get("https://registry.npmjs.org/zhin")
                .catch(() => ({ "dist-tags": { "latest": "0.0.0" } }))
                .then(res => res["dist-tags"]?.latest);
        }
        if (options.version === ctx.zhin.version) return "无需更新";
        const existVersions = await ctx.zhin.request
            .get("https://registry.npmjs.org/zhin")
            .catch(() => ({ "versions": {} }))
            .then(({ versions }) => Object.keys(versions));
        const hasVersion = existVersions.includes(options.version);
        if (!hasVersion) return "版本不存在";
        session.reply(`正在更新至${options.version}，更新结果将稍后返回`).catch(() => {});
        const [success, err] = await changeDependency(`zhin@${options.version}`);
        if (!success) return err;
        if (!options.restart)
            return `更新成功，将在下次重启生效。\n更新内容见：https://github.com/zhinjs/zhin/releases/tag/v${options.version}`;
        const channelId = Bot.getFullTargetId(session);
        process.send({
            type: "queue",
            body: {
                channelId,
                message: `已更新并重启。更新内容见：https://github.com/zhinjs/zhin/releases/tag/v${options.version}`,
            },
        });
        await session.reply("更新完成，正在重启...").catch(() => {});
        process.exit(51);
    });

exitCommand &&
    ctx
        .master()
        .command(exitCommand === true ? "exit" : exitCommand)
        .desc("关闭bot")
        .hidden()
        .option("-r [restart:boolean] 重新启动")
        .sugar("关机")
        .sugar("重启", { options: { restart: true } })
        .action<NSession<keyof Zhin.Adapters>>(async ({ options, session }) => {
            const channelId = Bot.getFullTargetId(session);
            if (!options.restart && !autoRestart) {
                await session.reply("正在关机...").catch(() => {});
                process.exit();
            }
            process.send({ type: "queue", body: { channelId, message: "已成功重启." } });
            await session.reply("正在重启...").catch(() => {});
            process.exit(51);
        });
ctx.zhin.on("ready", () => {
    process.send({ type: "start", body: { autoRestart } });
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
});
const handleMessage = (data: Message) => {
    if (data.type === "send") {
        let { channelId, message } = data.body;
        const [protocol, self_id, target_type, target_id] = channelId.split(":") as never[];
        const times = data.times;
        const bot = ctx.zhin.pickBot(protocol as keyof Zhin.Adapters, self_id);
        if (bot && bot.isOnline()) {
            if (times) message += `耗时：${(new Date().getTime() - times) / 1000}s`;
            bot.sendMsg(target_id, target_type, message);
        } else {
            const dispose = ctx.zhin.on("bot.online", (platform, bot_id) => {
                if (times) message += `耗时：${(new Date().getTime() - times) / 1000}s`;
                if (bot.adapter.protocol === platform && bot.self_id === bot_id) {
                    bot.sendMsg(target_id, target_type, message);
                    dispose();
                }
            });
        }
    }
};
process.on("message", handleMessage);
ctx.on("dispose", () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    process.off("message", handleMessage);
});
