import {Context} from "@/context";
import Element from "@/element";
import {Session, Zhin} from "@";

export const name = 'pluginManage'
function getPluginStatus(ctx:Context,session:Session,fullName:string){
    if(session.bot.options.enable_plugins.includes(fullName)) return '(已启用)'
    if(session.bot.options.disable_plugins.includes(fullName)) return '(已停用)'
    const plugin=ctx.pluginList.find(p=>p.options.fullName===fullName)
    if(!plugin) return ''
    const flag:`${keyof Zhin.Adapters}:${string|number}`=`${session.protocol}:${session.bot.self_id}`
    if(plugin.enableBots.includes(flag)) return '(已启用)'
    if(plugin.disableBots.includes(flag)) return '(已停用)'
}
export function install(ctx: Context) {
    ctx.command('测发送')
        .action(()=>Element('image',{src:"/Users/liuchunlang/Downloads/d926127f82097.jpeg"}))
    const command = ctx.command('plugin')
        .desc('插件管理')
        .hidden()
    command.subcommand('plugin.list')
        .desc('显示插件列表')
        .action(({session}) => {
            return ctx.app.getCachedPluginList().map((options, idx) => {
                const installStatus=ctx.app.hasInstall(options.fullName) ? ' (已安装)' : ''
                let enableStatus=installStatus ? getPluginStatus(ctx,session,options.fullName):''
                return `${idx + 1}.${options.fullName}${installStatus}${enableStatus} ${options.type}`
            }).join('\n')
        })

    command.subcommand('plugin.mount <name:string>')
        .desc('载入指定插件')
        .action(({session}, name) => {
            const options = ctx.app.getCachedPluginList().find(p => p.fullName === name)
            if (!options) return '当前没有该插件'
            try {
                ctx.app.plugin(name)
            } catch (e) {
                return '加载失败：' + e.message
            }
            return '载入成功'
        })
    command.subcommand('plugin.unmount <name:string>')
        .desc('移除指定插件')
        .action(({session}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '尚未载入该插件'
            try {
                plugin.unmount()
            } catch (e) {
                return '加载失败：' + e.message
            }
            return '移除成功'
        })
    command.subcommand('plugin.detail <name:string>')
        .desc('查看指定插件详情')
        .action(({options}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            return JSON.stringify(plugin.info, null, 2)
                .replace(/"/g, '')
                .replace(/\\/g, '')
        })
    command.subcommand('plugin.enable <name:string>')
        .desc('启用指定插件')
        .auth('admins','master')
        .action(({options,session}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            session.bot.enable(plugin)
            return `启用插件(${name})成功`
        })
    command.subcommand('plugin.disable <name:string>')
        .desc('禁用指定插件')
        .auth('admins','master')
        .action(({options,session}, name) => {
            const plugin = ctx.app.pluginList.find(p => p.options.fullName === name)
            if (!plugin) return '未找到插件：' + name
            session.bot.disable(plugin)
            return `禁用插件(${name})成功`
        })
}