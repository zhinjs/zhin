import { Plugin } from 'zhin';
import { JsonDB } from '@/db';
import * as path from 'path';
import * as process from 'process';
declare module 'zhin' {
  namespace App {
    interface Services {
      jsondb: JsonDB;
    }
  }
}
const db = new Plugin('JsonDB');
const configPath = path.resolve(process.cwd(), 'data', (process.env.jsondb ||= 'zhin.jsondb'));
db.service('jsondb', new JsonDB(configPath));
export default db;
