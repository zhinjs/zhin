/**
 * Adapter authoring contracts and platform-neutral Endpoint capabilities.
 * @module @zhin.js/adapter
 */
/** @internal 适配器 projection（AdapterIndex），框架内部机制，不承诺不 break。 */
export * from './adapter-index.js';
export * from './credentials.js';
/** @public 用户侧创作面：`defineAdapter`（`adapters/` 约定目录默认导出，承诺 semver）。 */
export * from './definition.js';
export { endpointEventGatewayToken } from './endpoint.js';
export type { EndpointEventGateway, EndpointEventEmitter } from './endpoint.js';
export type { EndpointIdentity, EndpointEvent, EndpointEventSink, EndpointIncomingMessage, EndpointConversation, EndpointSendRequest, EndpointSendPart, EndpointSendResult, EndpointTransportState, PlatformEvent } from './endpoint-contract.js';
/** @internal Process-level Peer Registry (framework mechanism, no semver promise). */
export * from './peer-registry.js';
export * from './endpoint-configuration.js';
export * from './endpoint-commands.js';
export * from './adapter-console-rpc.js';
export * from './adapter-notify.js';
export * from './endpoint-lifecycle.js';
export * from './endpoint-management.js';
export * from './endpoint-control.js';
export * from './endpoint-content.js';
export * from './endpoint-client.js';
export * from './provider.js';
export { default } from './provider.js';

export * from './adapter.js';
export * from './adapter-types.js';
export { endpointSpec, createEndpointSpecification, isEndpoint } from './endpoint-specification.js';
export type { Endpoint, EndpointSpecification, EndpointHooks } from './endpoint-specification.js';

export { ownedConsoleAdapter, mutateConsoleAdapter, prepareConsoleAdapterMutation } from './adapter-runtime-console.js';
