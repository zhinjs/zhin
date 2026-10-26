import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { shouldCopyFixture } from './fixture-copy-filter.mjs';
import { sqliteRuntimeArguments } from './sqlite-runtime.mjs';
import { Readable } from 'node:stream';
import { raw } from '@zhin.js/core/runtime';
import { sqliteStateHost } from './sqlite-state-host.mjs';
import { manualScheduleHost } from './schedule-host.mjs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginTestKit } from '../src/index.ts';
import { databaseRootHostToken, databaseHostToken, PluginDatabaseHost, rootPluginId, htmlRendererToken, scheduleRootHostToken, scheduleHostToken, PluginScheduleHost } from '@zhin.js/plugin-runtime';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = await mkdtemp(join(tmpdir(), 'zhin-test-kit-'));
const mode = process.argv[2] ?? 'base';
const put = async (path, content) => { await mkdir(dirname(path), {recursive:true}); await writeFile(path, content); };
const json = async (path, value) => put(path, JSON.stringify(value));
const link = async (name, source) => {
  const destination = join(temporary, 'node_modules', name);
  await mkdir(dirname(destination), {recursive:true}); await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
};
let kit;
let stateDatabase;
const schedules = manualScheduleHost();
try {
  for (const name of ['adapter','command','component','middleware','handler','schedule-feature','plugin-runtime','core','permission','im-contract','runtime','tool','skill']) {
    await link(`@zhin.js/${name}`, join(repo, 'packages/im', name));
  }
  await link('zhin.js', join(repo,'packages/im/zhin'));
  const mounted = mode.startsWith('group');
  await json(join(temporary,'package.json'), {name:'@test/kit-app', type:'module', dependencies:{'zhin.js':'*','@zhin.js/command':'*','@zhin.js/tool':'*','@zhin.js/skill':'*'}, zhin:{protocol:1,type:'plugin',entry:'./main.ts'}});
  await put(join(temporary,'main.ts'), "import {definePlugin, Schema} from 'zhin.js';export default definePlugin({name:'kit-app',config:Schema.object({label:Schema.string().default('v1')})});");
  if (mounted) {
    await cp(join(repo,'plugins/utils/group-suite'),join(temporary,'plugins/group-suite'),{recursive:true,filter: shouldCopyFixture});
    await symlink(await realpath(join(repo,'plugins/utils/group-suite/node_modules')),join(temporary,'plugins/group-suite/node_modules'),process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    await put(join(temporary,'commands/echo/[value]/index.ts'), "import {defineCommand} from 'zhin.js/command';export default defineCommand({permit:['group()','role(admin)'],params:{value:{type:'integer',min:1}},execute:({params,config})=>config.label+':'+params.value});");
    await put(join(temporary,'middlewares/trace/index.ts'), "import {defineMiddleware} from 'zhin.js/middleware';export default defineMiddleware({target:'outbound',async handle({input},next){if(input.payload==='block')return;await next();}});");
  }
  const config = mounted ? {configVersion:2,plugins:{alpha:'./plugins/group-suite',beta:'./plugins/group-suite'},alpha:{commandNamespace:'alpha', keywordReply:true, welcomeMessage:'欢迎 {name} ({id})'},beta:{commandNamespace:'beta',keywordReply:true}} : {configVersion:2};
  let renderCalls = 0;
  if(mounted) stateDatabase=await sqliteStateHost(join(temporary,'state.sqlite'));
  kit = await PluginTestKit.create({projectRoot:temporary,config,endpoints:['test','other'],segments: {html:'image',outboundMedia:['base64'],interactive:'text'}, installResources: mounted ? ({resources}) => {resources.provide(scheduleRootHostToken,schedules.host);resources.provide(scheduleHostToken,new PluginScheduleHost(rootPluginId(),schedules.host));resources.provide(databaseRootHostToken,stateDatabase.host);resources.provide(databaseHostToken,new PluginDatabaseHost(rootPluginId(),stateDatabase.host));if(mode==='group')resources.provide(htmlRendererToken, {async render(){renderCalls++;return {data:Buffer.from('fake-image'),format:'png',mimeType:'image/png',width:1,height:1};}});} : undefined});
  assert.equal(await kit.start(),1);
  const incoming = (content, roles=[],group='g1',endpoint='test') => kit.receive({content, conversation:{kind:'group',id:group},sender:{id:'u1',name:'Alice',roles},endpoint});
  if (!mounted) {
    assert.equal((await incoming('hello'))?.matched,false);
    assert.equal((await incoming('echo 2'))?.status,'denied');
    assert.equal((await incoming('echo x',['admin']))?.status,'invalid');
    assert.equal((await incoming('echo 2',['admin']))?.status,'executed');
    assert.equal(kit.deliveries.at(-1).payload,'v1:2');
    const stream = Readable.from(['native upload']);
    const native = { image: stream, label: { text: 'original' } };
    assert.equal((await kit.send({conversation:{kind:'group',id:'g1'},content:raw(native)})).status,'sent');
    const capture = kit.deliveries.at(-1).payload;
    assert.equal(capture.image,stream); assert.equal(stream.destroyed,false); assert.equal(Object.isFrozen(stream),false);
    native.label.text='changed'; assert.equal(kit.deliveries.at(-1).payload.label.text,'original');
    let received='';for await(const part of stream)received+=String(part);assert.equal(received,'native upload');
    const before = kit.deliveries.length;
    assert.equal((await kit.send({conversation:{kind:'group',id:'g1'},content:'block'})).status,'suppressed');
    assert.equal(kit.deliveries.length,before);
    const command=join(temporary,'commands/echo/[value]/index.ts');
    await put(command,(await readFile(command,'utf8')).replace("config.label+':'+params.value", "'hmr:'+params.value"));
    assert.equal((await kit.reloadSource(command)).status,'reloaded');
    await incoming('echo 3',['admin']);assert.equal(kit.deliveries.at(-1).payload,'hmr:3');
    const generation=kit.generation;
    await put(command, "export default {bad:true};");
    assert.equal((await kit.reloadSource(command)).status,'failed');
    assert.equal(kit.generation,generation);
    await incoming('echo 4',['admin']);assert.equal(kit.deliveries.at(-1).payload,'hmr:4');
    await assert.rejects(kit.patchConfig([{op:'set',path:['plugin','label'],value:2}]));
    assert.equal(kit.generation,generation);
    await put(command, "import {defineCommand} from 'zhin.js/command';export default defineCommand({permit:['group()','role(admin)'],params:{value:{type:'integer',min:1}},execute:({params})=>'recovered:'+params.value});");
    assert.equal((await kit.reloadSource(command)).status,'reloaded');
    await kit.patchConfig([{op:'set',path:['plugin','label'],value:'valid'}]);
    assert.equal(kit.generation,generation+2);
    const frame=kit.deliveries;assert.ok(Object.isFrozen(frame));assert.ok(Object.isFrozen(frame[0]));
    assert.equal((await kit.reloadSource(join(temporary,'.env'))).status,'restart-required');
    // The real coordinator latches process restart; a later call reports its actual failure, not stale reasons.
    assert.equal((await kit.reloadSource(command)).status,'failed');
    await kit.close();await kit.close();await assert.rejects(incoming('echo 5',['admin']));
    // Failed startup also disposes without requiring a successful generation.
    kit=await PluginTestKit.create({projectRoot:temporary,config:{configVersion:2,plugin:{label:2}}});
    await assert.rejects(kit.start());await kit.close();
    console.log('KIT_ACCEPTANCE_OK');
  } else {
    assert.equal((await incoming('alpha keyword-add hi secret'))?.status,'denied');
    assert.equal((await incoming('alpha keyword-add hi hello',['admin']))?.status,'executed');
    kit.clearDeliveries();await incoming('hi');assert.equal(kit.deliveries.at(-1).payload,'hello');
    kit.clearDeliveries();await incoming('hi',[],'g2');assert.equal(kit.deliveries.length,0);
    await incoming('hi',[],'g1','other');assert.equal(kit.deliveries.length,0);
    await incoming('beta keyword-list');assert.match(kit.deliveries.at(-1).payload,/没有/);
    await incoming('beta keyword-add bye goodbye',['owner']);
    kit.clearDeliveries();await incoming('bye');assert.equal(kit.deliveries.at(-1).payload,'goodbye');
    // Concurrent different senders mutate the same persistent state through real CAS retries.
    await Promise.all(Array.from({length:8},(_,i)=>kit.receive({content:`alpha keyword-add k${i} r${i}`,conversation:{kind:'group',id:'g1'},sender:{id:`s${i}`,roles:['admin']}})));
    await incoming('alpha keyword-list');for(let i=0;i<8;i++)assert.match(kit.deliveries.at(-1).payload,new RegExp(`k${i}`));
    // Identical group ids on two endpoint identities have separate check-in and teaching records.
    await incoming('alpha checkin');assert.match(kit.deliveries.at(-1).payload,/签到成功/);
    await incoming('alpha checkin',[],'g1','other');assert.match(kit.deliveries.at(-1).payload,/签到成功/);
    await incoming('alpha checkin');assert.match(kit.deliveries.at(-1).payload,/已经签到/);
    await incoming('alpha teach where|endpoint-one',['admin']);
    await incoming('alpha teach where|endpoint-two',['admin'],'g1','other');
    kit.clearDeliveries();await incoming('where');assert.equal(kit.deliveries.at(-1).payload,'endpoint-one');
    kit.clearDeliveries();await incoming('where',[],'g1','other');assert.equal(kit.deliveries.at(-1).payload,'endpoint-two');
    const group='g1';
    const notice={id:'join',type:'notice',name:'notice.group.member_increase',timestamp:Date.now(),metadata:{},conversation:{kind:'group',id:group},target:{id:'new-user',name:'Bob'}};
    kit.clearDeliveries();await kit.emit('notice.receive',notice);
    assert.equal(kit.deliveries.length,1);assert.equal(kit.deliveries[0].conversation.id,group);
    assert.deepEqual(kit.deliveries[0].payload,[{type:'text',data:{text:'欢迎 Bob (new-user)'}}]);
    kit.clearDeliveries();await kit.emit('notice.receive',{...notice,conversation:{kind:'private',id:'x'}});assert.equal(kit.deliveries.length,0);
    assert.equal(schedules.host.list().length,2);
    await schedules.tick();
    await incoming('alpha stats-card');if(mode==='group'){assert.equal(renderCalls,1);assert.equal(kit.deliveries.at(-1).payload[0].type,'image');}else{assert.equal(renderCalls,0);assert.equal(kit.deliveries.at(-1).payload[0].type,'text');assert.match(kit.deliveries.at(-1).payload[0].data.text,/今日本群消息统计/);}
    await assert.rejects(kit.patchConfig([{op:'set',path:['alpha','keywordReply'],value:'bad'}]));
    await incoming('hi');assert.equal(kit.deliveries.at(-1).payload,'hello');
    const source=join(temporary,'plugins/group-suite/commands/keyword-list/index.ts');
    await put(source,(await readFile(source,'utf8')).replace("return t(context.locale, 'keywordList',", "return '热更新词库\\n' + t(context.locale, 'keywordList',"));
    assert.equal((await kit.reloadSource(source)).status,'reloaded');
    await incoming('alpha keyword-list');assert.match(kit.deliveries.at(-1).payload,/热更新词库/);
    await incoming('hi');assert.equal(kit.deliveries.at(-1).payload,'hello');
    await incoming('bye');assert.equal(kit.deliveries.at(-1).payload,'goodbye');
    // Whole plugin reload replaces owner Resources, while persistent keywords keep their exact scope.
    const oldJobs=[...schedules.host.list()];
    const entry=join(temporary,'plugins/group-suite/plugin.ts');
    await put(entry,(await readFile(entry,'utf8')).replace("displayName: 'Group Suite'","displayName: 'Group Suite Reloaded'"));
    assert.equal((await kit.reloadSource(entry)).status,'reloaded');
    for(const job of oldJobs) {assert.equal(job.isActive(),false);await assert.rejects(Promise.resolve().then(()=>job.execute()),/retired|admission|inactive|disposed/);}
    assert.equal(schedules.host.list().length,2);
    await schedules.tick();
    kit.clearDeliveries();await incoming('hi');assert.equal(kit.deliveries.at(-1).payload,'hello');
    await incoming('bye');assert.equal(kit.deliveries.at(-1).payload,'goodbye');
    await incoming('hi',[],'g1','other');assert.equal(kit.deliveries.at(-1).payload,'goodbye');
    await kit.close();stateDatabase.close();stateDatabase=undefined;
    const output=execFileSync(process.execPath,[...(sqliteRuntimeArguments() ?? []),'--conditions=development','--import','tsx',fileURLToPath(new URL('./restart-probe.mjs',import.meta.url)),temporary],{encoding:'utf8'});
    assert.match(output,/KEYWORDS_PROCESS_RESTART_OK/);
    // No silent persistence fallback when a Database Host is absent.
    kit=await PluginTestKit.create({projectRoot:temporary,config,installResources:({resources})=>{resources.provide(scheduleRootHostToken,schedules.host);resources.provide(scheduleHostToken,new PluginScheduleHost(rootPluginId(),schedules.host));}});
    await assert.rejects(kit.start(),/Persistent keywords require a Database Host/);await kit.close();
    kit=await PluginTestKit.create({projectRoot:temporary,config:{configVersion:2,plugins:config.plugins,alpha:{commandNamespace:'alpha',keywordReply:true,ephemeralKeywords:true},beta:{commandNamespace:'beta',keywordReply:true,ephemeralKeywords:true}},installResources:({resources})=>{resources.provide(scheduleRootHostToken,schedules.host);resources.provide(scheduleHostToken,new PluginScheduleHost(rootPluginId(),schedules.host));}});
    await kit.start();await incoming('alpha keyword-list');assert.match(kit.deliveries.at(-1).payload,/没有/);await kit.close();
    console.log('GROUP_ACCEPTANCE_OK');
  }
} finally { await kit?.close();stateDatabase?.close();await rm(temporary,{recursive:true,force:true}); }
