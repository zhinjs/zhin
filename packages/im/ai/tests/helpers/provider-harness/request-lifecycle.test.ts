import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('keeps real SDK inter-chunk cancellation through GC on both mock and native loopback Fetch', async () => {
  const modulePath = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
  const code = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import { setTimeout as delay } from 'node:timers/promises';
    import { createMockFetch } from ${modulePath('./mock-fetch.ts')};
    import { createProfileRuntime, profileModel } from ${modulePath('../profile-runtime.ts')};
    import { createUserMessage } from ${modulePath('../../../src/llm/types/agent-message.ts')};
    import { classifyProviderError } from ${modulePath('../../../src/llm/provider-resilience.ts')};
    const chunk = {id:'probe',created:1,model:'local',choices:[{index:0,delta:{content:'partial'},finish_reason:null}]};
    let nativeSubmissions=0;
    const server = createServer(async(req,res)=>{for await(const chunk of req)void chunk;nativeSubmissions++;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(chunk)+'\\n\\n');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port+'/v1';
    const mock=createMockFetch([{sse:[{data:chunk}],hang:'after-events'}]);
    try {
      for(const transport of [mock.fetch,globalThis.fetch]) {
        const config={sdk:'openai-compatible',apiKey:'synthetic',baseUrl:url,chunkTimeoutMs:50,maxRetries:0};
        const runtime=createProfileRuntime({alias:'local',config,models:['local'],fetch:transport});
        try {
          const iterator=runtime.stream(profileModel('local',config,'local'),{systemPrompt:'',messages:[createUserMessage('synthetic')]} )[Symbol.asyncIterator]();
          let first;do{first=await iterator.next();}while(!first.done&&first.value.type!=='text_delta');
          assert.equal(first.value.type,'text_delta');
          const pending=iterator.next().catch(error=>({error}));
          for(let i=0;i<8;i++){globalThis.gc();await delay(1);}
          const outcome=await Promise.race([pending,delay(1500,'pending')]);
          assert.notEqual(outcome,'pending');assert.equal(classifyProviderError(outcome.error).kind,'timeout');
        } finally {await runtime.dispose();}
      }
      assert.equal(nativeSubmissions,1);assert.equal(mock.requests.length,1);
      console.log('mock-and-native-sdk-gc-timeout-passed');
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `;
  const result = await promisify(execFile)(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', code], { timeout: 5000 });
  expect(result.stdout).toContain('mock-and-native-sdk-gc-timeout-passed');
});
