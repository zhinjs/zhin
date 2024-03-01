import { Plugin } from 'zhin';
import { JsonDB } from './db';
declare module 'zhin' {
    namespace App {
        interface Services {
            jsondb: JsonDB;
        }
    }
}
declare const db: Plugin;
export default db;
