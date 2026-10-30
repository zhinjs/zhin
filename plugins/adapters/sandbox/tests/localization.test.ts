import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { sandboxText, sandboxEnglish } from '../pages/index/messages.js';
import * as traces from '../pages/index/agentTrace.js';
import * as playground from '../pages/index/playgroundState.js';
import * as transport from '../pages/index/sandboxTransport.js';

it('labels the conversation workspace and its existing details entry in both locales', () => {
  for (const [source, english] of [
    ['会话', 'Conversations'],
    ['会话列表', 'Conversation list'],
    ['新建会话', 'New conversation'],
    ['对话与轨迹', 'Conversation and trace'],
  ]) {
    expect(sandboxText('zh-CN', source!)).toBe(source);
    expect(sandboxText('en', source!)).toBe(english);
  }
});

it('localizes authored trace copy while retaining task content, identity and ISO timestamps', () => {
  const snapshot = {sessionKey:'sandbox:test:group:room',latestSequence:2,activeTurnIds:[],events:[
    {sequence:1,recordedAt:1700000000000,sessionKey:'sandbox:test:group:room',turnId:'run-1',type:'turn_start',data:{}},
    {sequence:2,recordedAt:1700000001000,sessionKey:'sandbox:test:group:room',turnId:'run-1',type:'turn_end',data:{}},
  ]};
  const source = JSON.stringify(snapshot);
  const report = traces.buildAgentRunReport(snapshot, {sessionName:'用户会话 {0}', taskPrompt:'保留原始正文',workingDirectory:'/tmp/用户'},'en');
  expect(report).toContain('# Agent run report');
  expect(report).toContain('用户会话 {0}'); expect(report).toContain('保留原始正文');
  expect(report).toContain('2023-11-14T22:13:20.000Z');
  expect(JSON.stringify(snapshot)).toBe(source);
  expect(traces.presentTraceEvent(snapshot.events[1]!, 'en').title).toBe('Turn completed');
  expect(traces.presentTraceEvent(snapshot.events[1]!).title).toBe('本轮完成');
});

it('preserves user placeholders and every authored translation slot', () => {
  expect(sandboxText('en','向 {0} 发送消息，支持 Markdown...',['用户 {1} ${TOKEN}'])).toBe('Message 用户 {1} ${TOKEN}; Markdown is supported…');
  for(const [source, target] of Object.entries(sandboxEnglish)) {
    const slots=(value:string)=>[...value.matchAll(/\{(\d+)\}/gu)].map(match=>match[1]).sort();
    expect(slots(target)).toEqual(slots(source));
  }
});

it('uses ready.locale without remounting or replacing stored conversations and drafts', async () => {
  const file=new URL('../pages/index/SandboxChat.tsx',import.meta.url);
  const source=await readFile(file,'utf8');
  const ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Sandbox') as ts.FunctionDeclaration;
  const returnNode=declaration.body!.statements.find(ts.isReturnStatement)!;
  const prefix=source.slice(declaration.getStart(ast),returnNode.getStart(ast)).replace('export default ','');
  const code=ts.transpileModule(prefix+'return {locale,handleInboundPayload,channels,messages,inputText,setInputText,atSuggestions};}',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
  let cursor=0; const slots:unknown[]=[];
  const original=playground.createDefaultPlaygroundState();
  const state={...original,sessions:original.sessions.map((item,index)=>index===0?{...item,name:'用户保留的会话'}:item)};
  const bindings={
    sandboxText, ...traces, ...playground, ...transport,
    loadPlaygroundState:()=>state,
    useState:(initial:any)=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],(next:any)=>{slots[index]=typeof next==='function'?next(slots[index]):next}];},
    useRef:(initial:any)=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},
    useMemo:(fn:()=>unknown)=>fn(),useCallback:(fn:unknown)=>fn,useEffect:()=>{},
  };
  const render=Function(...Object.keys(bindings),code+'; return Sandbox;')(...Object.values(bindings));
  const run=()=>{cursor=0;return render();}; let view=run();
  view.setInputText('未发送草稿'); view=run();
  // The existing socket owns an earlier callback; it must read the current locale ref.
  const inbound=view.handleInboundPayload;
  inbound({type:'ready',locale:'en',endpoint:'test',timestamp:1});view=run();
  expect(view.locale).toBe('en');expect(view.inputText).toBe('未发送草稿');expect(view.channels[0].name).toBe('用户保留的会话');
  expect(view.atSuggestions[0].name).toBe('Current user');
  inbound({type:'group',id:'new-room',content:'用户原文',timestamp:2});view=run();
  expect(view.channels.find((item:any)=>item.id==='new-room').name).toBe('Group scenario new-room');
  expect(view.messages.at(-1).content[0].data.text).toBe('用户原文');
  inbound({type:'ready',endpoint:'legacy',timestamp:3});view=run();expect(view.locale).toBe('zh-CN');
  expect(view.channels[0].name).toBe('用户保留的会话');expect(view.inputText).toBe('未发送草稿');
});
