import {App} from "@";
export const name= 'pluginManage'
export function install(bot:App){
    const command=bot.command('plugin')
        .desc('插件管理')
    command.subcommand('plugin.list')
        .desc('显示插件列表')
        .action(()=>{
            return bot.getCachedPluginList().map((plugin,idx)=>{
                return `${idx+1}. 插件名：${plugin.fullName}${bot.hasInstall(plugin.fullName)?' (已安装)':''} ${plugin.type}`
            }).join('\n')
        })
    command.subcommand('plugin.detail <name:string>')
        .desc('查看指定插件详情')
        .action(({options},name)=>{
            const {install,dispose,disposes,...detail}=bot.pluginList.find(p=>p.name===name)||{}
            if(!Object.keys(detail).length) return '未找到插件：'+name
            return JSON.stringify(detail,null,2)
                .replace(/"/g,'')
                .replace(/\\/g,'')
        })
}