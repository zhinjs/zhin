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
  ['@zhin.js/skill', ['SkillDefinition', 'SkillScope', 'parseSkillMarkdown']],
  ['@zhin.js/tool', [
    'AgentToolDefiner', 'AgentToolDefinition', 'ToolExecutionContext', 'ToolInvocationContext',
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
    'PluginConfigSchema', 'DeliveryTarget', 'createDeliveryTarget', 'JsonValue',
    'StateScope', 'StateRecord', 'StateWriteOptions', 'PersistentStatePort', 'PluginStateStore',
  ]],
  ['zhin.js/adapter', [
    'AdapterContext', 'AdapterDefinition', 'AdapterSegmentModelExtension', 'AdapterSegmentPolicy', 'Endpoint',
    'EndpointActivationContext',
    'EndpointCleanup', 'EndpointClientContext', 'EndpointClientToken', 'EndpointConnectionContext',
    'EndpointConversation', 'EndpointEvent', 'EndpointEventSink', 'EndpointIdentity',
    'EndpointImplementation', 'EndpointIncomingMessage', 'EndpointSendRequest',
    'PlatformEvent', 'AdapterCapability', 'AdapterInteractiveMode',
    'AdapterMarkdownMode', 'AdapterOperation', 'AdapterOperationDeclaration',
    'AdapterOutboundMedia', 'AdapterReactionDeclaration', 'HtmlOutboundMode', 'defineAdapter', 'defineEndpointClient',
  ]],
  ['zhin.js/agent', [
    'AgentResourceHub', 'AgentPreset', 'AgentTool', 'AgentToolExecutionContext',
    'AIHook', 'AIHookEvent', 'AIHookHandler', 'JsonSchema', 'McpConnection',
    'McpPrompt', 'McpResource', 'McpServerEntry', 'Message', 'PropertySchema',
    'ResourceScope', 'Skill', 'SubAgentDef', 'Tool', 'ToolParametersSchema',
    'AIHookEventType', 'ToolApprovalMode', 'ToolApprovalPolicy',
    'ToolScope', 'ToolToModelOutputFn', 'ToolToModelOutputInput',
  ]],
  ['zhin.js/command', [
    'CommandContext', 'CommandConversation', 'CommandDefiner', 'CommandDefinition', 'CommandMessage',
    'CommandParameterDefinition', 'CommandParamSchema', 'CommandScene', 'CommandSegment',
    'CommandSender', 'CommandSession', 'CommandDynamicValue', 'CommandParameterType',
    'CommandParameterValue', 'defineCommand',
    'CommandExecutionPolicy', 'CommandExecutionLimit',
    'CommandParams', 'CommandOptions', 'CommandOptionSchema', 'InferCommandParams', 'InferCommandOptions',
  ]],
  ['zhin.js/component', ['ComponentContext', 'ComponentDefinition', 'defineComponent']],
  ['zhin.js/core/runtime', [
    'Message', 'MessageBase', 'ComponentCall', 'IncomingContext', 'IncomingMessage',
    'MessageDispatchResult', 'OutboundMessageService', 'MessageSenderRef', 'OutboundEnvelope',
    'RawContent', 'SendRequest', 'ConversationAddress', 'SendContent',
    'outboundMessageToken',
  ]],
  ['zhin.js/handler', ['HandlerDefinition', 'HandlerEventMap', 'defineHandler']],
  ['zhin.js/middleware', [
    'MiddlewareContext', 'MiddlewareContinuation', 'MiddlewareDefinition',
    'MiddlewareDefinitionBase', 'MiddlewareNext', 'MiddlewarePhase',
    'MiddlewareTarget', 'OutboundMiddlewareNext', 'defineMiddleware',
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
  [...new Set((module.children ?? []).map((child) => child.name))].sort(),
]));
assert.deepEqual([...actualModules.keys()].sort(), [...expectedSurface.keys()].sort());
for (const [module, expected] of expectedSurface) {
  assert.deepEqual(actualModules.get(module), [...expected].sort(), `${module} public surface drifted`);
}

const expectedMembers = new Map([
  ['@zhin.js/host-http.HttpHost', ['address', 'listRoutes', 'route', 'ws']],
  ['zhin.js/agent.AgentResourceHub', [
    'addAgentPreset', 'addHook', 'addMcp', 'addSkill', 'addSubAgent',
    'connectMcp', 'createHookEvent', 'disconnectMcp', 'getHooksForEvent',
    'getSkillsForAgent', 'getSubAgentsForAgent', 'removeHook',
    'removeMcp', 'removeSkill', 'removeSubAgent', 'triggerHook',
  ]],
  ['zhin.js/core/runtime.MessageBase', [
    '$client', '$reply', '$replyFrom', '$replyToChannel', '$replyToGroup', '$replyToPrivate',
    '$sendTo', 'clientAdapter', 'content', 'conversation', 'endpointId', 'generation', 'id',
    'mentioned', 'message', 'metadata', 'origin', 'replyTo', 'segments', 'sender',
  ]],
  ['zhin.js.PluginDefinition', ['config', 'metadata', 'name', 'requires', 'setup']],
  ['zhin.js.PluginConfigSchema', ['output', 'toJsonSchema']],
  ['zhin.js.PluginDatabaseHost', [
    'constructor', 'define', 'dialect', 'models', 'owner', 'qualify', 'started', 'state', 'tables', 'unqualify',
  ]],
  ['zhin.js.PluginStateStore', ['constructor', 'owner', 'forUser', 'forConversation', 'get', 'set', 'delete', 'update']],
  ['zhin.js.PersistentStatePort', ['read', 'compareExchange']],
  ['zhin.js.StateRecord', ['revision', 'value', 'expiresAt']],
  ['zhin.js.StateWriteOptions', ['ttlMs']],
  ['zhin.js/command.CommandContext', [
    '$client', 'adapter', 'args', 'config', 'endpoint', 'generation', 'has', 'input', 'interaction',
    'options', 'owner', 'params', 'project', 'scene', 'segments', 'sender', 'signal', 'use',
  ]],
  ['zhin.js/command.CommandOptionSchema', [
    'alias', 'choices', 'default', 'description', 'max', 'min', 'optional', 'pattern', 'type', 'validate',
  ]],
  ['zhin.js/command.CommandDefinition', [
    'adapter', 'alias', 'description', 'execute', 'execution', 'options', 'params', 'permit', 'shortcut',
  ]],
  ['zhin.js/command.CommandExecutionPolicy', ['cooldownMs', 'maxConcurrent', 'progressAfterMs']],
  ['zhin.js/command.CommandExecutionLimit', ['reason', 'retryAfterMs']],
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

// The public IM documentation must describe the facade's actual defaults,
// rather than the transport-neutral Feature's unknown input type.
const middleware = (project.children ?? []).find(module => module.name === 'zhin.js/middleware');
const defineMiddleware = middleware?.children?.find(child => child.name === 'defineMiddleware');
assert(defineMiddleware, 'Missing IM middleware facade reflection');
assert.deepEqual(
  (defineMiddleware.signatures ?? []).map(signature => signature.typeParameters
    ?.find(parameter => parameter.name === 'TInput')?.default?.toString()),
  ['OutboundEnvelope', 'MessageBase'],
  'Middleware docs must use OutboundEnvelope and canonical Message authoring defaults',
);

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
