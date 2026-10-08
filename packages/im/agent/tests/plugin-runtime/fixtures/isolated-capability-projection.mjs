import { resolve } from 'node:path';
import { NativeDevelopmentModuleRuntime } from '../../../../runtime/src/native-development-runtime.ts';
import { CapabilityIngress } from '../../../src/plugin-runtime/capability-ingress.ts';
import { ToolIndex, isToolIndex, defineAgentTool, toolFeatureId } from '../../../../tool/src/index.ts';
import { SkillIndex, isSkillIndex } from '../../../../skill/src/index.ts';
import { AgentIndex, isAgentIndex } from '../../../../agent-feature/src/index.ts';
import { McpIndex, isMcpIndex } from '../../../../mcp-feature/src/index.ts';
import { createCapabilitySlot, rootPluginId } from '../../../../plugin-runtime/src/index.ts';
const root=rootPluginId();
const snapshot={generation:7,root,tree:new Map([[root,{id:root,instanceKey:'root',packageName:'@test/root',packageRoot:'/test',children:[]}]]),config:new Map([[root,{}]]),resources:new Map([[root,new Map()]]),capabilities:new Map(),projections:new Map()};
const slot=createCapabilitySlot({owner:root,feature:toolFeatureId,localName:'echo',source:'/tools/echo/index.ts',definition:defineAgentTool({description:'Local echo',requiresApproval:'never',execute:input=>input})});
snapshot.capabilities.set(slot.id,slot);
const runtime=new NativeDevelopmentModuleRuntime({projectRoot:process.cwd(),watch:false});
const results=[];
for(const [pkg,Constructor,guard] of [['tool',ToolIndex,isToolIndex],['skill',SkillIndex,isSkillIndex],['agent-feature',AgentIndex,isAgentIndex],['mcp-feature',McpIndex,isMcpIndex]]) {
 const {default:provider}=await runtime.load(resolve(`packages/im/${pkg}/src/provider.ts`));
 const result=await provider.runtime.project(pkg==='tool'?[slot]:[],{snapshot,signal:new AbortController().signal});
 snapshot.projections.set(provider.id,result.value);
 results.push({pkg,sameClass:result.value instanceof Constructor,guard:guard(result.value),rejectFuture:guard({$projection:result.value.$projection.replace('/1','/2')}),rejectUnbranded:guard({list(){return []}})});
}
let active=true;
const capabilities=await new CapabilityIngress().read(snapshot,root,()=>active);
const echoed=await capabilities.tools[0].execute({message:'isolated-module-echo'},{signal:new AbortController().signal,traceId:'trace',turnId:'turn',sessionKey:'session',origin:{kind:'internal',source:'test'},principal:{subjectId:'test',roles:[]},policy:{permissions:[],unattended:true,network:{enabled:false,httpsOnly:true,allowedDomains:[]}}});
active=false; let inactiveRejected=false;
try {await capabilities.tools[0].execute({},{});} catch(error) {inactiveRejected=error.message.includes('scope has ended');}
console.log(JSON.stringify({results,toolNames:capabilities.tools.map(tool=>tool.name),echoed,inactiveRejected}));
await runtime.close();
