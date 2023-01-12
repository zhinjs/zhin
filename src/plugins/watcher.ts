import {FSWatcher, watch} from 'chokidar'
import {App} from "@/app";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'

import * as path from "path";
import {Context,Plugin} from "@/context";
export const name='pluginWatcher'
export function install(ctx:Context, root:string){
    function reloadDependency(plugin: Plugin,changeFile:string){
        const options=ctx.app.options.plugins[plugin.name]
        try {
            ctx.dispose(plugin)
            delete require.cache[changeFile]
            if(changeFile!==plugin.fullPath){
                delete require.cache[plugin.fullPath]
                delete require.cache[plugin.fullPath+'/index.js']
                delete require.cache[plugin.fullPath+'/index.ts']
                delete require.cache[plugin.fullPath+'/index.cjs']
                delete require.cache[plugin.fullPath+'/index.mjs']
            }
            const newPlugin=ctx.app.load<Plugin.Install>(plugin.fullPath,'plugin')
            ctx.app.plugin(newPlugin,options)
            const dependentPlugins=ctx.app.pluginList.filter(p=>p.using && p.using.includes(plugin.name))
            for(const dependentPlugin of dependentPlugins){
                ctx.app.logger.info('正在重载依赖该插件的插件:'+dependentPlugin.name)
                try{
                    reloadDependency(dependentPlugin,dependentPlugin.fullPath)
                }catch (e){
                    ctx.app.logger.warn(e.message)
                }
            }
            ctx.app.logger.info(`已重载:${newPlugin.name}`)
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
        if(path.resolve(process.env.configPath)===changeFileName){
            const newOptions:App.Options=Yaml.load(fs.readFileSync(process.env.configPath,"utf8")) as any
            ctx.app.changeOptions(newOptions)
        }else{
            const plugins=ctx.app.pluginList.filter(p=>filename.includes(p.fullPath))
            for(const plugin of plugins){
                reloadDependency(plugin,changeFileName)
            }
        }
    })
    ctx['disposes'].push(()=>{
        watcher.close()
        return true
    })
}