import { Registry,Definition,Databases,Database } from "@zhin.js/database";
import { DatabaseConfig,Models } from "../types.js";
import { defineContext,Plugin } from "../plugin.js";
import { SystemLogDefinition } from "../models/system-log.js";
import { UserDefinition } from "../models/user.js";
declare module "../plugin" {
    namespace Plugin {
        interface Extensions {
            defineModel<K extends keyof Models>(name: K, definition: Definition<Models[K]>): void;
        }
        interface Contexts {
            database: Database<any,Models,any>;
        }
    }
}
export function defineDatabaseService<K extends keyof Databases>(config: DatabaseConfig<K>) {
    const db = Registry.create<Models,K>(config.dialect, config,{
        SystemLog: SystemLogDefinition,
        User: UserDefinition,
    });
    return defineContext({
        name: 'database',
        description: '数据库服务',
        mounted: async () => {
            await db.start();
            return db;
        },
        dispose: async () => {
            await db.stop();
        },
        extensions: {
            defineModel<K extends keyof Models>(this:Plugin,name: K, definition: Definition<Models[K]>) {
                db.define(name, definition);
                this.logger.debug(`Model "${String(name)}" defined by plugin "${this.name}"`);
            }
        },
    });
}