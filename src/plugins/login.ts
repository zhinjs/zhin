import {Context} from "@/context";

export const name = 'terminalLogin'
export const scope = 'icqq' as const

export function install(ctx: Context) {
    ctx=ctx.platform('icqq')
    ctx.on('icqq.system.login.slider', (e) => {
        console.log('输入滑块地址获取的ticket后继续。\n滑块地址:    ' + e.url)
        process.stdin.once('data', (data) => {
            e.bot.internal.submitSlider(data.toString().trim())
        })
    })
    ctx.on('icqq.system.login.qrcode', (e) => {
        console.log('扫码完成后回车继续:    ')
        process.stdin.once('data', () => {
            e.bot.internal.login()
        })
    })
    ctx.on('icqq.system.login.device', (e) => {
        console.log('请选择验证方式:(1：短信验证   其他：扫码验证)')
        process.stdin.once('data', (data) => {
            if (data.toString().trim() === '1') {
                e.bot.internal.sendSmsCode()
                console.log('请输入手机收到的短信验证码:')
                process.stdin.once('data', (res) => {
                    e.bot.internal.submitSmsCode(res.toString().trim())
                })
            } else {
                console.log('扫码完成后回车继续：' + e.url)
                process.stdin.once('data', () => {
                    e.bot.internal.login()
                })
            }
        })
    })
    ctx.command('大傻逼')
        .action(async ({session}) => {
            await session.intercept(`请输入'对不起'，否则这坎过不去了`, (newSession) => {
                session.reply(['你输入【', ...newSession.elements, '】也没用'])
            }, '对不起')
            return '好了，原谅你了'
        })
}
