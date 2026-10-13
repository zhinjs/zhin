import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PluginTestKit } from '../src/index.ts';
import { databaseHostToken,databaseRootHostToken,PluginDatabaseHost,rootPluginId,scheduleRootHostToken,scheduleHostToken,PluginScheduleHost } from '@zhin.js/plugin-runtime';
import { sqliteStateHost } from './sqlite-state-host.mjs';
import { manualScheduleHost } from './schedule-host.mjs';
const projectRoot = process.argv[2];
const db=sqliteStateHost(join(projectRoot,'state.sqlite'));
const schedules=manualScheduleHost();
const kit=await PluginTestKit.create({projectRoot,config:{plugins:{alpha:{commandNamespace:'alpha',keywordReply:true},beta:{commandNamespace:'beta',keywordReply:true}}},installResources:({resources})=>{
  resources.provide(scheduleRootHostToken,schedules.host);
  resources.provide(scheduleHostToken,new PluginScheduleHost(rootPluginId(),schedules.host));
  resources.provide(databaseRootHostToken,db.host);
  resources.provide(databaseHostToken,new PluginDatabaseHost(rootPluginId(),db.host));
}});
try {
  await kit.start();
  const receive=(content)=>kit.receive({content,conversation:{kind:'group',id:'g1'},sender:{id:'u1'}});
  await receive('hi');assert.equal(kit.deliveries.at(-1).payload,'hello');
  await receive('bye');assert.equal(kit.deliveries.at(-1).payload,'goodbye');
  console.log('KEYWORDS_PROCESS_RESTART_OK');
} finally {await kit.close();db.close();}
