import {useApp} from "@";
useApp()
    .command('查 [who:mention]')
    .desc('测试指令，后续取消')
    .action(async ({session}, who) => {
        return JSON.stringify(await session.bot.getStrangerInfo(Number(who.data.user_id)), null, 2)
    })
