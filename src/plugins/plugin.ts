import {Context} from "@/context";
import {exec} from "child_process";
import {promisify} from 'util'
import {Session, useContext, Zhin} from "@";
const promiseExec=promisify(exec)
const changeDependency=async (name?:string,unInstall?:boolean)=>{
    const cmd=`npm ${unInstall?'un':''}install ${name?? ''} --force`
    const {stderr}=await promiseExec(cmd,{cwd:process.cwd()})
    if(stderr){
        if(/npm ERR/i.test(stderr)){
            return [false,stderr]
        }
    }
    return [true,'']
}
const ctx = useContext()
function getPluginStatus(ctx: Context, session: Session, fullName: string) {
    if (session.bot.options.disable_plugins.includes(fullName)) return '(已停用)'
    const plugin = ctx.pluginList.find(p => p.options.fullName === fullName)
    if (!plugin) return ''
    const flag: `${keyof Zhin.Adapters}:${string | number}` = `${session.protocol}:${session.bot.self_id}`
    if (plugin.disableBots.includes(flag)) return '(已停用)'
}

const command = ctx.command('plugin')
    .desc('插件管理')
    .hidden()
command.subcommand('plugin.list')
    .desc('显示插件列表')
    .option('official','-o 显示社区插件')
    .action(async ({session,options}) => {
        if(!options.official){
            const plugins=await ctx.zhin.getInstalledModules('plugin')
            return plugins.map((o, idx) => {
                const installStatus = ctx.zhin.hanMounted(o.fullName) ? ' (已载入)' : ''
                let enableStatus = installStatus ? getPluginStatus(ctx, session, o.fullName) : ''
                return `${idx + 1}.${o.fullName}${installStatus}${enableStatus} ${o.type}`
            }).join('\n')
        }else{
            const packages = await ctx.zhin.getMarketPackages()
            return packages.map((o,idx)=>{
                const installStatus = ctx.zhin.hanMounted(o.name) ? ' (已载入)' : ''
                let enableStatus = installStatus ? getPluginStatus(ctx, session, o.name) : ''
                return `${idx + 1}.${o.name}${installStatus}${enableStatus} ${o.scope==='zhinjs'?'官方':'社区'}`
            }).join('\n')
        }
    })

command.subcommand('plugin.install <name:string>')
    .desc('安装指定插件')
    .action(async ({session}, name) => {
        const packages = await ctx.zhin.getMarketPackages()
        const options=packages.find(p=>p.name===name)
        if (!options) return '没有该插件'
        await session.reply('已开始安装...')
        try{
            const [success,err]=await changeDependency(`${name}@${options.version}`)
            return success?'安装成功':`安装失败:\n${err}`
        }catch (e){
            ctx.zhin.logger.warn(e.message)
            return `安装失败:\n${e.message}`
        }
    })
command.subcommand('plugin.uninstall <name:string>')
    .desc('卸载指定插件')
    .action(async ({session}, name) => {
        const packages = await ctx.zhin.getInstalledModules('plugin')
        const options=packages.find(p=>p.fullName===name)
        if (!options) return '没有安装该插件'
        await session.reply('已开始卸载...')
        try{
            const [success,err]=await changeDependency(`${name}`,true)
            return success?'卸载成功':`卸载失败:\n${err}`
        }catch (e){
            ctx.zhin.logger.warn(e.message)
            return `卸载失败:\n${e.message}`
        }
    })
command.subcommand('plugin.mount <name:string>')
    .desc('载入指定插件')
    .action(async ({session}, name) => {
        const plugins=await ctx.zhin.getInstalledModules('plugin')
        const options = plugins.find(p => p.fullName === name)
        if (!options) return '当前没有该插件'
        try {
            ctx.zhin.plugin(name)
        } catch (e) {
            return '加载失败：' + e.message
        }
        return '载入成功'
    })
command.subcommand('plugin.unmount <name:string>')
    .desc('移除指定插件')
    .action(({session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p => p.options.fullName === name)
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
        const plugin = ctx.zhin.pluginList.find(p => p.options.fullName === name)
        if (!plugin) return '未找到插件：' + name
        return JSON.stringify(plugin.info, null, 2)
            .replace(/"/g, '')
            .replace(/\\/g, '')
    })
command.subcommand('plugin.enable <name:string>')
    .desc('启用指定插件')
    .auth('admins', 'master')
    .action(({options, session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p => p.options.fullName === name)
        if (!plugin) return '未找到插件：' + name
        session.bot.enable(plugin)
        return `启用插件(${name})成功`
    })
command.subcommand('plugin.disable <name:string>')
    .desc('禁用指定插件')
    .auth('admins', 'master')
    .action(({options, session}, name) => {
        const plugin = ctx.zhin.pluginList.find(p => p.options.fullName === name)
        if (!plugin) return '未找到插件：' + name
        session.bot.disable(plugin)
        return `禁用插件(${name})成功`
    })