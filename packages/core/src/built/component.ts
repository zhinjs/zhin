import { Component,renderComponents } from "../component.js";
import { SendOptions,MaybePromise } from "../types.js";
import { Plugin } from "../plugin.js";
type Listener=(options:SendOptions)=>MaybePromise<SendOptions>;
export class ComponentService extends Map<string, Component<any>> {
  #listener:Listener;
  constructor(public plugin: Plugin) {
    super();
    this.#listener=renderComponents.bind(void 0, this);
  }
  start(){
    this.plugin.root.on('before.sendMessage', this.#listener);
  }
  stop(){
    this.plugin.root.off('before.sendMessage', this.#listener);
  }

  add<T extends Component<any>>(component: T): () => void {
    this.set(component.name, component);
    return () => this.delete(component.name);
  }

  remove(component: Component<any> | string): boolean {
    const name = typeof component === 'string' ? component : component.name;
    return this.delete(name);
  }
}

