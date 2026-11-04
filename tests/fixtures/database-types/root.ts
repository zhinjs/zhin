import { Registry, Sqlite, type Database } from '@zhin.js/database';
import * as Core from '@zhin.js/core';
import * as Agent from '@zhin.js/agent';
import * as AgentModels from '@zhin.js/agent/model-runtime';
import * as AgentTurn from '@zhin.js/agent/turn';
import * as Zhin from 'zhin.js';

type Tables = { users: { id: number; name: string }; audit: { key: string } };
const definitions: Database.DefinitionObj<Tables> = { users: { id: { type: 'integer' }, name: { type: 'text' } } };
const database: Sqlite<Tables> = Registry.create<Tables, 'sqlite'>('sqlite', { filename: ':memory:' }, definitions);
database.model('users').select('id', 'name');
// @ts-expect-error table names must remain tied to the schema
database.model('missing');
// @ts-expect-error columns must remain tied to their table
database.model('audit').select('name');
// @ts-expect-error an unselected server dialect is not part of the default type map
Registry.create<Tables, 'pg'>('pg', {});
// @ts-expect-error remote classes are available only from their precise dialect entry
type RemovedRootClass = import('@zhin.js/database').PG;
void (undefined as unknown as RemovedRootClass);
void [Core, Agent, AgentModels, AgentTurn, Zhin];
