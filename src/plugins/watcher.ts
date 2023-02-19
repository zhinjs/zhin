import {FSWatcher, watch} from 'chokidar'
import {useOptions, Zhin,Schema} from "@";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'
import * as path from "path";
import {Plugin} from "@/plugin";
import {Context} from "@/context";
export const name='pluginWatcher'
export const Config=Schema.string().default(process.cwd()).required().description('监听路径')
export function install(ctx:Context){
    const root=Config(useOptions('plugins.watcher'))
    function reloadDependency(plugin: Plugin,changeFile:string){
        try {
            const parent=plugin.context.parent
            plugin.unmount()
            delete require.cache[changeFile]
            if(changeFile!==plugin.options.fullPath){
                delete require.cache[plugin.options.fullPath]
                delete require.cache[plugin.options.fullPath+'/index.js']
                delete require.cache[plugin.options.fullPath+'/index.ts']
                delete require.cache[plugin.options.fullPath+'/index.cjs']
                delete require.cache[plugin.options.fullPath+'/index.mjs']
            }
            const newPlugin=ctx.app.load<Plugin.Install>(plugin.options.fullPath,'plugin')
            parent.plugin(newPlugin)
            ctx.app.logger.info(`已重载插件:${newPlugin.name}`)
        } catch (e) {
            ctx.app.logger.warn(e)
        }
    }

    const watchPath=path.resolve(process.cwd(),root||'.')
    const watcher: FSWatcher = watch(watchPath, {
        ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
    })

    watcher.on('change', (filename) => {
        const changeFileName=path.resolve(process.cwd(),filename)
        if(path.resolve(process.env.configPath||='zhin.yaml')===changeFileName){
            const newOptions:Zhin.Options=Yaml.load(fs.readFileSync(process.env.configPath,"utf8")) as any
            ctx.app.changeOptions(newOptions)
        }else{
            const plugins=ctx.app.pluginList.filter(p=>filename.includes(p.options.fullPath))
            for(const plugin of plugins){
                reloadDependency(plugin,changeFileName)
            }
        }
    })
    return ()=>{
        watcher.close()
        return true
    }
}