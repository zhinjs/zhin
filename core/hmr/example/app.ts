import path from "path";
import { HMR,Dependency,Context,HMRConfig } from "../lib";

export class Plugin extends Dependency<Plugin>{
  commands = new Map<string,()=>void>();
  constructor(app:App,name:string,filePath:string){
    super(app,name,filePath);
  }

}

export class App extends HMR<Plugin> {
  static currentPlugin:Plugin;
  config:App.Config;
  constructor(config:Partial<App.Config>={}) {
    config=Object.assign({},App.defaultConfig,config);
    super('app',__filename,{
      ...config,
      dirs:config.plugin_dirs
    });
    this.config=config as App.Config;
  }
  createDependency(name:string,filePath: string):Plugin {
    return new Plugin(this,name,filePath);
  }

  use(filePath:string){
    this.emit('internal.add',filePath);
  }

  async start(mode='prod'){
    for(const name of this.config.plugins){
      this.use(name);
    }
    // 等待应用就绪
    await this.waitForReady();
    console.log('app start',mode);
  }
}

export namespace App{
  export interface Config extends HMRConfig{
    plugin_dirs:string[];
    plugins:string[];
  }
  export const defaultConfig:Config={
    plugin_dirs:[],
    plugins:[],
    disable_dependencies:[]
  }
}

export type Message={
  content:string;
  sender:string;
  timestamp:number;
}

function getPlugin(hmr:HMR,filename:string,hookName:string){
  const plugin = hmr.dependencies.get(filename) as Plugin;
  if(plugin) return plugin;
  if(!HMR.currentDependency) throw new Error(`${hookName} must be called within a App context`);
  const childPlugin=HMR.currentDependency.findChild<Plugin>(filename);
  if(childPlugin) return childPlugin as Plugin;
  const name=path.basename(filename).replace(path.extname(filename),'');
  const newPlugin=new Plugin(HMR.currentHMR as unknown as App,name,filename);
  HMR.currentDependency.dependencies.set(filename,newPlugin);
  newPlugin.parent=HMR.currentDependency;
  return newPlugin;
}

// 获取应用实例
export function useApp() {
  const hmr = HMR.currentHMR;
  if (!hmr) throw new Error('useApp must be called within an App context');
  return hmr as unknown as App;
}

// 获取当前插件实例
export function usePlugin() {
  const hmr = HMR.currentHMR;
  if (!hmr) throw new Error('usePlugin must be called within an App context');
  return getPlugin(hmr,HMR.getCurrentFile(__filename),'usePlugin');
}

// 创建 Context
export function createContext<T>(context: Context<T>): Context<T> {
  const plugin = usePlugin();
  return plugin.createContext(context);
}
export function useContext<T>(name: string): Context<T> {
  const plugin=usePlugin();
  return plugin.useContext<T>(name);
}
export function requireContext(name: string){
  const plugin=usePlugin();
  plugin.requiredContexts.add(name)
}

// 添加命令
export function addCommand(command: string, fn: () => void) {
  const plugin = usePlugin();
  plugin.commands.set(command, fn);
}

// 监听初始化事件
export function onMounted(hook: (plugin: Plugin) => Promise<void>) {
  const plugin = usePlugin();
  plugin.on('mounted', hook);
}

// 监听群组消息
export function onGroupMessage(fn: (message: Message) => void) {
  const plugin = usePlugin();
  plugin.on('message.group', fn);
}

// 监听私聊消息
export function onPrivateMessage(fn: (message: Message) => void) {
  const plugin = usePlugin();
  plugin.on('message.private', fn);
}

// 监听销毁事件
export function onDispose(fn: () => void) {
  const plugin = usePlugin();
  plugin.on('dispose', fn);
}