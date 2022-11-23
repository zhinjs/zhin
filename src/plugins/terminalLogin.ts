import {Plugin,Bot} from "@";

export const name='terminalLogin'
export function install(this:Plugin,bot:Bot){
    bot.on('system.login.slider',(e)=>{
        console.log(`请输入在地址：${e.url}获取到的的ticket`)
        process.stdin.once('data',(data)=>{
            bot.submitSlider(data.toString().trim())
            bot.login()

        })
    })
        .on('system.login.qrcode',(e)=>{
        console.log('请扫描二维码后回车继续')
        process.stdin.once('data',(data)=>{
            bot.login()
        })
    })
        .on('system.login.device',(e)=>{
        console.log('请输入手机收到的验证码')
        bot.sendSMSCode()
        process.stdin.once('data',(data)=>{
            bot.submitSMSCode(data.toString().trim())
            bot.login()
        })
    })
}