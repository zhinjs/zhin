import {useContext} from "@";
const ctx=useContext().platform('icqq')
ctx.on('icqq.system.login.slider', (e) => {
    ctx.logger.mark('输入滑块地址获取的ticket后继续。\n滑块地址:    ' + e.url)
    process.stdin.once('data', (data) => {
        e.bot.internal.submitSlider(data.toString().trim())
    })
})
ctx.on('icqq.system.login.qrcode', (e) => {
    ctx.logger.mark('扫码完成后回车继续:    ')
    process.stdin.once('data', () => {
        e.bot.internal.login()
    })
})
ctx.on('icqq.system.login.device', (e) => {
    ctx.logger.mark('请选择设备验证方式:(1：短信验证   其他：扫码验证)')
    process.stdin.once('data', (data) => {
        if (data.toString().trim() === '1') {
            e.bot.internal.sendSmsCode()
            ctx.logger.mark('请输入手机收到的短信验证码:')
            process.stdin.once('data', (res) => {
                e.bot.internal.submitSmsCode(res.toString().trim())
            })
        } else {
            ctx.logger.mark(`完成扫码验证后回车继续。\n验证地址:    ${e.url}`)
            process.stdin.once('data', () => {
                e.bot.internal.login()
            })
        }
    })
})
ctx.on('icqq.system.login.error',e=>{
    e.bot.adapter.logger.error(`${e.bot.self_id}:${e.message}`)
})
