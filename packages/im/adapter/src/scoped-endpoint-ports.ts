import type { EndpointControl } from './endpoint-control.js';
import type { EndpointManagement } from './endpoint-management.js';

/** One typed invocation supplies the lease's signal, never a guessed argument position. */
export interface EndpointPortCall<T> {
  readonly run: (signal: AbortSignal) => Promise<T>;
  readonly signal?: AbortSignal;
}
export interface EndpointPortInvoker {
  <T>(call: EndpointPortCall<T>): Promise<T>;
}
interface ScopedPortOptions<T> {
  /** Original semantic port; method receivers and private fields belong to it. */
  readonly port: T;
  /** Captures and releases one call against the same concrete Client. */
  readonly invoke: EndpointPortInvoker;
}

/** Decorate declared control methods, including non-enumerable prototype implementations. */
export function scopeEndpointControl({ port, invoke }: ScopedPortOptions<EndpointControl>): Readonly<EndpointControl> {
  const { recall, edit, addReaction, removeReaction, typing } = port;
  return Object.freeze<EndpointControl>({
    ...(recall ? { recall: request => invoke({ signal: request.signal,
      run: signal => recall.call(port, { ...request, signal }) }) } : {}),
    ...(edit ? { edit: request => invoke({ signal: request.signal,
      run: signal => edit.call(port, { ...request, signal }) }) } : {}),
    ...(addReaction ? { addReaction: request => invoke({ signal: request.signal,
      run: signal => addReaction.call(port, { ...request, signal }) }) } : {}),
    ...(removeReaction ? { removeReaction: request => invoke({ signal: request.signal,
      run: signal => removeReaction.call(port, { ...request, signal }) }) } : {}),
    ...(typing ? { typing: request => invoke({ signal: request.signal,
      run: signal => typing.call(port, { ...request, signal }) }) } : {}),
  });
}

/** Semantic method wrappers retain source receivers without proxying or copying native SDK state. */
export function scopeEndpointManagement({ port, invoke }: ScopedPortOptions<EndpointManagement>): Readonly<EndpointManagement> {
  const { inspectGroupMember, inspectGroupScene, inspectGroupMemberProfile, moderateGroupMember,
    listFriends, listGroups, listChannels, listGroupMembers, listRequests, approveRequest, rejectRequest,
    kickGroupMember, muteGroupMember, setGroupAdmin, deleteFriend, sendGroupNotice } = port;
  return Object.freeze<EndpointManagement>({
    ...(inspectGroupMember ? { inspectGroupMember: request => invoke({ signal: request.signal,
      run: signal => inspectGroupMember.call(port, { ...request, signal }) }) } : {}),
    ...(inspectGroupScene ? { inspectGroupScene: request => invoke({ signal: request.signal,
      run: signal => inspectGroupScene.call(port, { ...request, signal }) }) } : {}),
    ...(inspectGroupMemberProfile ? { inspectGroupMemberProfile: request => invoke({ signal: request.signal,
      run: signal => inspectGroupMemberProfile.call(port, { ...request, signal }) }) } : {}),
    ...(moderateGroupMember ? { moderateGroupMember: request => invoke({ signal: request.signal,
      run: signal => moderateGroupMember.call(port, { ...request, signal }) }) } : {}),
    ...(listFriends ? { listFriends: request => invoke({ signal: request?.signal,
      run: signal => listFriends.call(port, { ...request, signal }) }) } : {}),
    ...(listGroups ? { listGroups: request => invoke({ signal: request?.signal,
      run: signal => listGroups.call(port, { ...request, signal }) }) } : {}),
    ...(listChannels ? { listChannels: request => invoke({ signal: request?.signal,
      run: signal => listChannels.call(port, { ...request, signal }) }) } : {}),
    ...(listGroupMembers ? { listGroupMembers: request => invoke({ signal: request.signal,
      run: signal => listGroupMembers.call(port, { ...request, signal }) }) } : {}),
    ...(listRequests ? { listRequests: request => invoke({ signal: request?.signal,
      run: signal => listRequests.call(port, { ...request, signal }) }) } : {}),
    ...(approveRequest ? { approveRequest: request => invoke({ signal: request.signal,
      run: signal => approveRequest.call(port, { ...request, signal }) }) } : {}),
    ...(rejectRequest ? { rejectRequest: request => invoke({ signal: request.signal,
      run: signal => rejectRequest.call(port, { ...request, signal }) }) } : {}),
    ...(kickGroupMember ? { kickGroupMember: request => invoke({ signal: request.signal,
      run: signal => kickGroupMember.call(port, { ...request, signal }) }) } : {}),
    ...(muteGroupMember ? { muteGroupMember: request => invoke({ signal: request.signal,
      run: signal => muteGroupMember.call(port, { ...request, signal }) }) } : {}),
    ...(setGroupAdmin ? { setGroupAdmin: request => invoke({ signal: request.signal,
      run: signal => setGroupAdmin.call(port, { ...request, signal }) }) } : {}),
    ...(deleteFriend ? { deleteFriend: request => invoke({ signal: request.signal,
      run: signal => deleteFriend.call(port, { ...request, signal }) }) } : {}),
    ...(sendGroupNotice ? { sendGroupNotice: request => invoke({ signal: request.signal,
      run: signal => sendGroupNotice.call(port, { ...request, signal }) }) } : {}),
  });
}
