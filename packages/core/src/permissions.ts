import { MaybePromise } from "@zhin.js/types";
import { RegisteredAdapter } from "./types.js";
import { Message } from "./message.js";
import { AdapterMessage } from "./types.js";
import { App } from "./app.js";
export type PermissionItem<T extends RegisteredAdapter = RegisteredAdapter> = {
    name: string | RegExp
    check: PermissionChecker<T>
}
export type PermissionChecker<T extends RegisteredAdapter = RegisteredAdapter> = (name: string, message: Message<AdapterMessage<T>>) => MaybePromise<boolean>
export class Permissions extends Array<PermissionItem>{
    constructor(private readonly app: App) {
        super();
        this.add(Permissions.define(/^adapter\([^)]+\)$/, (name, message) => {
            return message.$adapter === name.replace(/^adapter\(([^)]+)\)$/, '$1');
        }));
        this.add(Permissions.define(/^group\([^)]+\)$/, (name, message) => {
            const match=name.match(/^group\(([^)]+)\)$/);
            if(!match) return false;
            const id=match[1];
            if(message.$channel.type !== 'group') return false;
            if(id===''||id==='*') return true;
            return message.$channel.id === id;
        }));
        this.add(Permissions.define(/^private\([^)]+\)$/, (name, message) => {
            const match=name.match(/^private\(([^)]+)\)$/);
            if(!match) return false;
            const id=match[1];
            if(message.$channel.type !== 'private') return false;
            if(id===''||id==='*') return true;
            return message.$channel.id === id;
        }));
        this.add(Permissions.define(/^channel\([^)]+\)$/, (name, message) => {
            const match=name.match(/^channel\(([^)]+)\)$/);
            if(!match) return false;
            const id=match[1];
            if(message.$channel.type !== 'channel') return false;
            if(id===''||id==='*') return true;
            return message.$channel.id === id;
        }));
        this.add(Permissions.define(/^user\([^)]+\)$/,(name,message)=>{
            const match=name.match(/^channel\(([^)]+)\)$/);
            if(!match) return false;
            const id=match[1];
            return message.$sender.id===id;
        }))
    }
    add(permission: PermissionItem) {
        this.push(permission);
    }
    get(name: string): PermissionItem | undefined {
        return this.app.dependencyList.reduce((result,dep)=>{
            result.push(...dep.permissions)
            return result;
        },[...this]).find(p => new RegExp(p.name).test(name));
    }
}
export namespace Permissions{
    export function define<T extends RegisteredAdapter = RegisteredAdapter>(name: string | RegExp, check: PermissionChecker<T>): PermissionItem<T> {
        return { name, check };
    }
}