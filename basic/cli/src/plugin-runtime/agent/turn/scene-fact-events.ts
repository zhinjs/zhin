/**
 * ADR 0041 §6 write-through: a member / group side event updates the persistent scene facts (level 2)
 * in the same place the matching `EventMessage` is recorded. Only rows that already hold a platform
 * baseline are changed; a leave or kick deletes the member row.
 */
import type { RuntimeSceneEventSignal } from '@zhin.js/core/runtime';
import type { SceneFactStore, SceneMemberRole } from '@zhin.js/agent';
import { capabilityLocalName } from './request.js';

/** OneBot-style ids that mean "everyone" (a scene-wide mute, not a member). */
const WHOLE_SCENE_IDS = new Set(['0', 'all']);
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function roleOf(role: string, enabled: boolean): SceneMemberRole | undefined {
  if (role !== 'admin' && role !== 'owner') return undefined;
  return enabled ? role : 'member';
}

/** @returns whether the event is one the scene facts care about. */
export async function applySceneEventToFacts(store: SceneFactStore, signal: RuntimeSceneEventSignal, now: () => number = Date.now): Promise<boolean> {
  const event = signal.event;
  const conversation = event.conversation;
  if (conversation.kind !== 'group' && conversation.kind !== 'channel') return false;
  const platform = capabilityLocalName(String(conversation.endpoint.id));
  const scope = conversation.kind === 'channel' ? 'channel' : 'group';
  const sceneId = String(conversation.id);
  const self = new Set(signal.selfIds.map(String));
  switch (event.type) {
    case 'member.joined': {
      const id = String(event.member.id);
      if (self.has(id)) return true;
      await store.patchGroup(platform, scope, sceneId, { memberDelta: 1 });
      return true;
    }
    case 'member.left': {
      const id = String(event.member.id);
      await store.deleteMember(platform, scope, sceneId, id);
      if (!self.has(id)) await store.patchGroup(platform, scope, sceneId, { memberDelta: -1, admin: { id, enabled: false } });
      return true;
    }
    case 'member.role_changed': {
      const id = String(event.member.id);
      const role = roleOf(String(event.role), event.enabled === true);
      if (!role) return false;
      await store.patchMember(platform, scope, sceneId, id, { platformRole: role });
      await store.patchGroup(platform, scope, sceneId, {
        ...(self.has(id) ? { botRole: role } : {}),
        ...(role === 'owner' ? { ownerId: id } : { admin: { id, enabled: role === 'admin' } }),
      });
      return true;
    }
    case 'member.muted':
    case 'member.unmuted': {
      const id = String(event.member.id);
      const muted = event.type === 'member.muted';
      if (WHOLE_SCENE_IDS.has(id)) {
        await store.patchGroup(platform, scope, sceneId, { muteAll: muted });
        return true;
      }
      const seconds = muted ? Number(event.durationSeconds) || 0 : 0;
      const at = (muted && Number(event.timestamp)) || now();
      // A zero duration on a mute means "until lifted"; the same 30-day ceiling the session profile uses.
      const mutedUntil = !muted ? 0 : seconds > 0 ? at + seconds * 1000 : at + MONTH_MS;
      await store.patchMember(platform, scope, sceneId, id, { mutedUntil });
      if (self.has(id)) await store.patchGroup(platform, scope, sceneId, { botMuteUntil: mutedUntil });
      return true;
    }
    case 'member.card_changed':
      await store.patchMember(platform, scope, sceneId, String(event.member.id), { card: event.value ?? '' });
      return true;
    case 'member.title_changed':
      await store.patchMember(platform, scope, sceneId, String(event.member.id), { title: event.value ?? '' });
      return true;
    default:
      return false;
  }
}
