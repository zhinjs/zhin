import assert from'node:assert/strict';
const tier=process.argv[2],result={tier,facade:import.meta.resolve('zhin.js')};
const facade=await import('zhin.js');assert.equal(typeof facade.definePlugin,'function');assert.equal('ZhinAgent' in facade,false);assert.equal('AIService' in facade,false);
if(tier==='im'){
 result.missing=[];for(const name of['zhin.js/agent','zhin.js/ai']){let error;try{await import(name);}catch(caught){error=caught;}assert.equal(error?.code,'ERR_MODULE_NOT_FOUND');assert.ok(error.message.includes(name.endsWith('/agent')?'@zhin.js/agent':'@zhin.js/ai'));result.missing.push({name,code:error.code});}
}else{
 const agent=await import('zhin.js/agent'),ai=await import('zhin.js/ai');assert.equal(typeof agent.ZhinAgent,'function');assert.equal(typeof agent.AIService,'function');assert.equal(typeof ai.LlmApiRuntime,'function');result.agent=import.meta.resolve('zhin.js/agent');result.ai=import.meta.resolve('zhin.js/ai');
 const{createOpenAI}=await import('@ai-sdk/openai');assert.equal(typeof createOpenAI,'function');const modelHandle=createOpenAI({apiKey:'local-fixture-never-sent'}).chat('gpt-4o-mini');assert.equal(modelHandle.modelId,'gpt-4o-mini');result.providerHandle=true;
 const runtime=new ai.LlmApiRuntime();runtime.registerProvider('local',{sdk:'openai'},['fixture']);let calls=0;
 runtime.registerApiProvider({api:'ai-sdk',stream(){calls++;const message={role:'assistant',content:[{type:'text',text:'installed-local-response'}],api:'ai-sdk',provider:'local',model:'fixture',usage:ai.EMPTY_TOKEN_USAGE,stopReason:'stop',timestamp:Date.now()};return ai.createAssistantMessageEventStream(async push=>{push({type:'done',message});return message;});}});
 let terminal;for await(const event of ai.agentLoop(ai.createUserMessage('local-only'),{systemPrompt:'',messages:[],tools:[]},{model:runtime.model('local','fixture'),transport:runtime})){if(event.type==='agent_end')terminal=event;}
 assert.equal(calls,1);assert.ok(terminal.messages.some(message=>message.role==='assistant'&&message.content.some(block=>block.type==='text'&&block.text==='installed-local-response')));result.localLoop={calls,ended:true,text:'installed-local-response'};
}
console.log(JSON.stringify(result));
