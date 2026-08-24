import assert from 'node:assert/strict';
import {
  Application,
  PackageJsonReader,
  TSConfigReader,
  TypeDocReader,
} from 'typedoc';

const expectedSurface = new Map([
  ['@zhin.js/host-http', [
    'AuthenticatedTokenPrincipal', 'HttpHost', 'HttpHostAddress', 'WsConnection',
    'WsHandle', 'AuthScope', 'HttpHandler', 'ListedRoute', 'OpenApiParameter',
    'RouteMeta', 'HttpRouteRegistration', 'httpHostToken',
  ]],
  ['@zhin.js/prompt-section', [
    'AgentPromptSectionDefinition', 'AgentPromptSectionInput', 'PromptProfile',
    'PromptSectionLayer', 'PromptSectionRetention', 'defineAgentPromptSection',
  ]],
  ['@zhin.js/skill', ['SkillDefinition', 'parseSkillMarkdown']],
  ['@zhin.js/tool', [
    'AgentToolDefinition', 'ToolExecutionContext', 'ToolInvocationContext',
    'ToolInvocationPolicy', 'ToolQuestionPort', 'ToolQuestionRequest', 'ToolApproval',
    'ToolInvocationOrigin', 'ToolQuestionAnswer', 'ToolQuestionType', 'ToolScope',
    'defineAgentTool',
  ]],
  ['zhin.js', [
    'ConfigView', 'DatabaseHostConsole', 'DatabaseHostModel', 'DatabaseHostSelection',
    'DatabaseHostSelectResult', 'DatabaseHostTable', 'OutboundConversation',
    'OutboundEditInput', 'OutboundEndpointCapabilities', 'OutboundEndpointInput',
    'OutboundHost', 'OutboundMessage', 'OutboundReactionInput', 'OutboundRecallInput',
    'OutboundRemoveReactionInput', 'OutboundSendInput', 'OutboundTypingInput',
    'PluginDatabaseHost', 'PluginDefinition', 'PluginInstanceView', 'PluginMetadata',
    'PluginScheduleHost', 'PluginSetupContext', 'ScheduleJobRegistration',
    'DatabaseHostType', 'OutboundEndpointOperation', 'databaseHostToken', 'definePlugin',
    'outboundHostToken', 'scheduleHostToken',
  ]],
  ['zhin.js/adapter', [
    'AdapterContext', 'AdapterDefinition', 'AdapterSegmentPolicy', 'Endpoint',
    'EndpointClientContext', 'EndpointClientToken', 'EndpointEvent', 'EndpointIdentity',
    'EndpointSendRequest', 'PlatformEvent', 'AdapterCapability', 'AdapterInteractiveMode',
    'AdapterMarkdownMode', 'AdapterOperation', 'AdapterOperationDeclaration',
    'AdapterOutboundMedia', 'HtmlOutboundMode', 'defineAdapter', 'defineEndpointClient',
  ]],
  ['zhin.js/agent', [
    'AgentResourceHub', 'AgentPreset', 'AgentTool', 'AgentToolExecutionContext',
    'AIHook', 'AIHookEvent', 'AIHookHandler', 'JsonSchema', 'McpConnection',
    'McpPrompt', 'McpResource', 'McpServerEntry', 'Message', 'PropertySchema',
    'ResourceScope', 'Skill', 'SubAgentDef', 'Tool', 'ToolParametersSchema',
    'AIHookEventType', 'ToolApprovalMode', 'ToolApprovalPolicy', 'ToolLike',
    'ToolScope', 'ToolToModelOutputFn', 'ToolToModelOutputInput',
  ]],
  ['zhin.js/command', [
    'CommandContext', 'CommandConversation', 'CommandDefinition', 'CommandMessage',
    'CommandParameterDefinition', 'CommandParamSchema', 'CommandScene', 'CommandSegment',
    'CommandSender', 'CommandSession', 'CommandDynamicValue', 'CommandParameterType',
    'CommandParameterValue', 'defineCommand',
  ]],
  ['zhin.js/component', ['ComponentContext', 'ComponentDefinition', 'defineComponent']],
  ['zhin.js/core/runtime', [
    'Message', 'ComponentCall', 'IncomingContext', 'IncomingMessage',
    'MessageDispatchResult', 'OutboundMessageService', 'MessageSenderRef', 'OutboundEnvelope',
    'RawContent', 'SendRequest', 'ConversationAddress', 'SendContent',
    'outboundMessageToken',
  ]],
  ['zhin.js/handler', ['HandlerDefinition', 'HandlerEventMap', 'defineHandler']],
  ['zhin.js/middleware', [
    'MiddlewareContext', 'MiddlewareDefinition', 'MiddlewareNext', 'MiddlewarePhase',
    'MiddlewareTarget', 'defineMiddleware',
  ]],
]);

const app = await Application.bootstrapWithPlugins({}, [
  new TypeDocReader(),
  new PackageJsonReader(),
  new TSConfigReader(),
]);
const project = await app.convert();
assert(project, 'TypeDoc could not create a project reflection');
app.validate(project);
assert.equal(app.logger.errorCount, 0, 'TypeDoc reported errors');
assert.equal(app.logger.warningCount, 0, 'TypeDoc reported warnings');

const actualModules = new Map((project.children ?? []).map((module) => [
  module.name,
  (module.children ?? []).map((child) => child.name).sort(),
]));
assert.deepEqual([...actualModules.keys()].sort(), [...expectedSurface.keys()].sort());
for (const [module, expected] of expectedSurface) {
  assert.deepEqual(actualModules.get(module), [...expected].sort(), `${module} public surface drifted`);
}

const expectedMembers = new Map([
  ['@zhin.js/host-http.HttpHost', ['address', 'listRoutes', 'route', 'ws']],
  ['zhin.js/agent.AgentResourceHub', [
    'addAgentPreset', 'addHook', 'addMcp', 'addSkill', 'addSubAgent', 'addTool',
    'connectMcp', 'createHookEvent', 'disconnectMcp', 'getHooksForEvent',
    'getSkillsForAgent', 'getSubAgentsForAgent', 'getToolsForAgent', 'removeHook',
    'removeMcp', 'removeSkill', 'removeSubAgent', 'removeTool', 'triggerHook',
  ]],
  ['zhin.js/core/runtime.Message', [
    '$client', '$reply', '$replyFrom', '$replyToChannel', '$replyToGroup', '$replyToPrivate',
    '$sendTo', 'clientAdapter', 'content', 'conversation', 'endpointId', 'generation', 'id',
    'mentioned', 'message', 'metadata', 'replyTo', 'segments', 'sender',
  ]],
]);
for (const [qualifiedName, expected] of expectedMembers) {
  const separator = qualifiedName.lastIndexOf('.');
  const moduleName = qualifiedName.slice(0, separator);
  const symbolName = qualifiedName.slice(separator + 1);
  const symbol = (project.children ?? [])
    .find((module) => module.name === moduleName)
    ?.children?.find((child) => child.name === symbolName);
  assert(symbol, `Missing public reflection: ${qualifiedName}`);
  assert.deepEqual(
    (symbol.children ?? []).map((child) => child.name).sort(),
    [...expected].sort(),
    `${qualifiedName} public members drifted`,
  );
}

const forbiddenMembers = new Set([
  '$feature', '$parameter', 'addFeature', 'agentStreamBus', 'approvalOnce',
  'tokenRegistry', '[generationAdmissionBinder]',
]);
const projectedAgentPackages = new Set(['@zhin.js/agent', '@zhin.js/ai']);
const visitedTypes = new WeakSet();
const visitType = (type, owner) => {
  if (!type || typeof type !== 'object' || visitedTypes.has(type)) return;
  visitedTypes.add(type);
  if (
    type.type === 'reference'
    && projectedAgentPackages.has(type.package)
    && !type.reflection
    && !type.refersToTypeParameter
  ) {
    assert.fail(`Unreflected Agent API dependency at ${owner}: ${type.package}.${type.name}`);
  }
  for (const key of [
    'checkType', 'elementType', 'extendsType', 'falseType', 'indexType', 'objectType',
    'queryType', 'target', 'trueType', 'typeArguments', 'types',
  ]) {
    const value = type[key];
    for (const nested of Array.isArray(value) ? value : [value]) visitType(nested, owner);
  }
};
const visit = (reflection, enforceAgentClosure) => {
  assert(!forbiddenMembers.has(reflection.name), `Internal member leaked: ${reflection.name}`);
  const owner = reflection.getFullName?.() ?? reflection.name;
  if (enforceAgentClosure) {
    visitType(reflection.type, owner);
    for (const type of reflection.extendedTypes ?? []) visitType(type, owner);
    for (const type of reflection.implementedTypes ?? []) visitType(type, owner);
  }
  for (const child of reflection.children ?? []) visit(child, enforceAgentClosure);
  for (const signature of reflection.signatures ?? []) visit(signature, enforceAgentClosure);
  for (const parameter of reflection.parameters ?? []) visit(parameter, enforceAgentClosure);
};
for (const module of project.children ?? []) {
  visit(module, module.name === 'zhin.js/agent');
}

console.log(`API reference surface check passed (${expectedSurface.size} modules).`);
