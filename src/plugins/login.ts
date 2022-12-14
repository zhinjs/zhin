import {Context} from "@/context";
export const name='terminalLogin'

export function install(ctx:Context){
    ctx.on('oicq.system.login.slider',(e)=>{
        console.log('输入滑块地址获取的ticket后继续。\n滑块地址:    '+e.url)
        process.stdin.once('data',(data)=>{
            e.bot.submitSlider(data.toString().trim())
        })
    })
    ctx.on('oicq.system.login.qrcode',(e)=>{
        console.log('扫码完成后回车继续:    ')
        process.stdin.once('data',()=>{
            e.bot.login()
        })
    })
    ctx.on('oicq.system.login.device',(e)=>{
        console.log('请输入密保手机收到的验证码:')
        e.bot.sendSmsCode()
        process.stdin.once('data',(data)=>{
            e.bot.submitSmsCode(data.toString().trim())
        })
    })
}
