/** Project declaration entry loads the platform registration; business commands import no Adapter class. */
declare class TypedEndpoint {
  sendLike(user: number, count: number): Promise<boolean>;
  endpointOnly(): 'native-endpoint';
}
declare class TypedAdapter {
  readonly adapterEvents: { 'message.group': { group_id: number }; 'message.private': { user_id: number } };
  getEndpoint(instanceId: string): TypedEndpoint | undefined;
  adapterOnly(): 'typed-adapter';
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'typed-session-test': TypedAdapter }
}
export {};
