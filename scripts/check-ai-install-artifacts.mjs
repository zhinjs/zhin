#!/usr/bin/env node
/** Local published-artifact installation smoke. Never publishes or calls a model. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,readdir,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {dependencyClosure} from './lib/workspace-graph.mjs';
import {withWorkspaceTarballOverrides} from './workspace-pack-closure.mjs';
const exec=promisify(execFile),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(repo,'test-results/ai-install-artifacts');await mkdir(output,{recursive:true});
const resumeAt=process.argv.indexOf('--resume-root');
const root=resumeAt<0?await mkdtemp(join(tmpdir(),'zhin-ai-installed-')):resolve(process.argv[resumeAt+1]);
const archives=join(root,'archives');await mkdir(archives,{recursive:true});
const roots=['zhin.js','@zhin.js/agent','@zhin.js/cli'];
const closure=[...new Map(roots.flatMap(name=>dependencyClosure(name)).map(entry=>[entry.name,entry])).values()];
const packageManager=JSON.parse(await readFile(join(repo,'package.json'),'utf8')).packageManager;
const securityOverrides=parse(await readFile(join(repo,'pnpm-workspace.yaml'),'utf8')).overrides??{};
const allowNetwork=process.argv.includes('--allow-network');
const report={root,allowNetwork,buildRequested:process.argv.includes('--build'),packages:[],stages:[]};
async function run(command,args,cwd,label){const childEnv={...process.env,NODE_OPTIONS:'',CI:'true'};delete childEnv.NODE_PATH;try{const result=await exec(command,args,{cwd,env:childEnv,maxBuffer:30*1024*1024});await writeFile(join(output,label+'.log'),result.stdout+'\n'+result.stderr);return result.stdout;}catch(error){await writeFile(join(output,label+'.log'),(error.stdout??'')+'\n'+(error.stderr??'')+'\n'+error.message);throw error;}}
async function save(){await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));}
try{
 console.log(JSON.stringify({root,packages:closure.length,build:report.buildRequested}));
 if(report.buildRequested)await run('pnpm',[...closure.flatMap(entry=>['--filter',entry.name]),'build'],repo,'build');
 const packed=new Map();
 for(const entry of closure){const before=new Set(await readdir(archives));const version=JSON.parse(await readFile(join(repo,entry.dir,'package.json'),'utf8')).version;const existing=[...before].find(name=>name===entry.name.replace('@','').replace('/','-')+'-'+version+'.tgz');
 if(resumeAt>=0 && existing){const tarball=join(archives,existing);packed.set(entry.name,{tarball});report.packages.push({...entry,tarball});continue;}
 await run('pnpm',['pack','--pack-destination',archives],join(repo,entry.dir),'pack-'+entry.name.replaceAll('/','-'));const created=(await readdir(archives)).filter(name=>name.endsWith('.tgz')&&!before.has(name));if(created.length!==1)throw new Error('Expected one tarball for '+entry.name);const tarball=join(archives,created[0]);packed.set(entry.name,{tarball});report.packages.push({...entry,tarball});}
 const external={};for(const name of['ai','zod','@ai-sdk/openai']){const manifest=JSON.parse(await readFile(join(repo,'packages/im/ai/node_modules',name,'package.json'),'utf8'));external[name]=manifest.version;}
 for(const tier of['im','ai']){
  const consumer=join(root,tier);await mkdir(consumer,{recursive:true});const realConsumer=await realpath(consumer);
  const dependencies={'zhin.js':'file:'+packed.get('zhin.js').tarball,...(tier==='ai'?{'@zhin.js/agent':'file:'+packed.get('@zhin.js/agent').tarball,'@zhin.js/cli':'file:'+packed.get('@zhin.js/cli').tarball,'@zhin.js/adapter':'file:'+packed.get('@zhin.js/adapter').tarball,'@zhin.js/command':'file:'+packed.get('@zhin.js/command').tarball,'@zhin.js/component':'file:'+packed.get('@zhin.js/component').tarball,'@zhin.js/tool':'file:'+packed.get('@zhin.js/tool').tarball,...external}:{})};
  const manifest=withWorkspaceTarballOverrides({name:'zhin-installed-'+tier,private:true,type:'module',packageManager,dependencies,pnpm:{overrides:securityOverrides}},closure,packed);
  await writeFile(join(consumer,'package.json'),JSON.stringify(manifest,null,2));await writeFile(join(consumer,'.npmrc'),'auto-install-peers=false\nstrict-peer-dependencies=false\n');
  await run('pnpm',['install',allowNetwork?'--prefer-offline':'--offline','--registry=https://registry.npmjs.org','--ignore-scripts','--prod'],consumer,'install-'+tier);
  const probe=await readFile(join(repo,'scripts/fixtures/ai-install-artifacts-probe.mjs'),'utf8');await writeFile(join(consumer,'probe.mjs'),probe);
  const result=JSON.parse((await run(process.execPath,['probe.mjs',tier],consumer,'probe-'+tier)).trim());
  const installed=await realpath(join(consumer,'node_modules/zhin.js'));if(!installed.startsWith(realConsumer+'/'))throw new Error('Installed facade unexpectedly links to workspace');
  const checked=[];const virtualStore=join(consumer,'node_modules/.pnpm');const storeEntries=await readdir(virtualStore);
  for(const entry of tier==='im'?dependencyClosure('zhin.js'):closure){let found=false;for(const storeEntry of storeEntries){const directory=join(virtualStore,storeEntry,'node_modules',entry.name);try{await access(join(directory,'package.json'));}catch{continue;}const location=await realpath(directory);if(!location.startsWith(realConsumer+'/'))throw new Error('Workspace contamination: '+entry.name);checked.push({name:entry.name,location});found=true;break;}if(!found)throw new Error('Packed workspace dependency missing: '+entry.name);}
  report.stages.push({tier,consumer,realConsumer,installed,result,packedWorkspaceRealpaths:checked,environment:{NODE_PATH:'unset',NODE_OPTIONS:'empty'}});
  if(tier==='ai'){const cliOutput=await run(process.execPath,[join(consumer,'node_modules/@zhin.js/cli/bin/zhin.js'),'--help'],consumer,'cli-help');if(!cliOutput.includes('runtime'))throw new Error('Installed CLI help did not expose runtime');report.stages.push({tier:'cli',help:true});}
  await save();console.log(JSON.stringify({tier,result}));
 }
 report.passed=true;await save();console.log('PASS: actual tarball consumers, optional AI exports, installed CLI and local deterministic agentLoop.');
}catch(error){report.passed=false;report.error={code:error.code,message:error.message};await save();console.error(error.message);process.exitCode=1;}
