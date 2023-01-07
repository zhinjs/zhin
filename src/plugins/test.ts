import {App} from "@";

export const name = 'test'

export function install(app: App) {
    app.command('send <message:number>')
        .action(async ({session}, message) => {
            const result=await session.prompt.confirm('请输入测试文本')
            console.log(result)
            if(result===undefined) return '输入超时'
            return message+String(result)
        })
}