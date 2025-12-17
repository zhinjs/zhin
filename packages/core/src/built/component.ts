import { Component,renderComponents } from "../component.js";
import { Plugin } from "../plugin.js";

export class ComponentService extends Map<string, Component<any>> {
  constructor(public plugin: Plugin) {
    super();
    plugin.on('before.sendMessage', renderComponents.bind(void 0, this));
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

