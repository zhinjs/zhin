import { randomUUID } from 'node:crypto';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import type { DingTalkMessage, ResolvedDingTalkConfig } from './protocol.js';

export interface DingTalkCardCallback { outTrackId?: string; spaceType?: string; spaceId?: string; userId?: string; userIdType?: number; corpId?: string; content?: string }
interface CardRecord { conversation: ConversationRef; spaceType: string; spaceId: string; staffId?: string; senderId?: string; corpId?: string; payloads: Set<string>; expiresAt: number }
/** Endpoint-owned, bounded correlation. Cards from old generations deliberately cannot dispatch. */
export class DingTalkCards {
  #epoch = 0;
  #records = new Map<string, CardRecord>();
  #contexts = new Map<string, DingTalkMessage>();
  remember(conversation: ConversationRef, event: DingTalkMessage): void {
    this.#contexts.delete(conversation.id); this.#contexts.set(conversation.id, event);
    while (this.#contexts.size > 1024) this.#contexts.delete(this.#contexts.keys().next().value!);
  }
  clear(): void { this.#epoch++; this.#records.clear(); this.#contexts.clear(); }
  prepare(config: ResolvedDingTalkConfig, conversation: ConversationRef, payload: unknown) {
    const segments = Array.isArray(payload) ? payload : [payload];
    const keyboard = segments.filter(item => item && typeof item === 'object' && item.type === 'keyboard');
    if (!keyboard.length) return undefined;
    if (config.mode !== 'stream' || !config.cardTemplateId) throw new EndpointDeliveryError('card_template_required', 'DingTalk callbacks require a configured Stream card template', 'not_sent');
    if (keyboard.length !== 1) throw new EndpointDeliveryError('invalid_payload', 'DingTalk supports one keyboard per card', 'not_sent');
    const rows = keyboard[0].data?.rows;
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw new EndpointDeliveryError('invalid_payload', 'DingTalk keyboard requires button rows', 'not_sent');
    const buttons = rows.flat();
    const count = config.cardButtonCount ?? 2;
    if (!buttons.length || buttons.length > count || buttons.some((button: any) => typeof button.label !== 'string' || typeof button.payload !== 'string' || !button.payload || button.disabled)) throw new EndpointDeliveryError('invalid_payload', 'DingTalk keyboard exceeds the fixed template or contains invalid/disabled buttons', 'not_sent');
    const context = this.#contexts.get(conversation.id);
    if (!context || (conversation.kind !== 'group' && conversation.kind !== 'private')) throw new EndpointDeliveryError('card_context_required', 'DingTalk card requires a current inbound conversation', 'not_sent');
    const spaceType = conversation.kind === 'group' ? 'IM_GROUP' : 'IM_ROBOT';
    const spaceId = spaceType === 'IM_GROUP' ? conversation.id : context.senderStaffId;
    if (!spaceId) throw new EndpointDeliveryError('card_context_required', 'DingTalk private card requires senderStaffId', 'not_sent');
    const text = segments.filter(item => item?.type !== 'keyboard').map(item => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text' || item?.type === 'markdown') return String(item.data?.text ?? item.data?.content ?? '');
      throw new EndpointDeliveryError('invalid_payload', 'DingTalk interactive cards accept text/markdown and keyboard only', 'not_sent');
    }).join('');
    const cardParamMap: Record<string, string> = { title: '消息', text };
    for (let i = 0; i < count; i++) { cardParamMap[`button${i}_label`] = buttons[i]?.label ?? ''; cardParamMap[`button${i}_payload`] = buttons[i]?.payload ?? ''; cardParamMap[`button${i}_visible`] = buttons[i] ? 'true' : 'false'; }
    const id = randomUUID();
    const record: CardRecord = { conversation, spaceType, spaceId, staffId: context.senderStaffId, senderId: context.senderId, corpId: context.senderCorpId, payloads: new Set(buttons.map((button: any) => button.payload)), expiresAt: Date.now() + 3_600_000 };
    return { id, record, epoch: this.#epoch, body: { cardTemplateId: config.cardTemplateId, outTrackId: id, cardData: { cardParamMap }, callbackType: 'STREAM', userIdType: 1, openSpaceId: `dtv1.card//${spaceType}.${spaceId}`, imGroupOpenSpaceModel: { supportForward: false }, imRobotOpenSpaceModel: { supportForward: false }, ...(spaceType === 'IM_GROUP' ? { imGroupOpenDeliverModel: { robotCode: config.robotCode ?? config.appKey } } : { imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT' } }) } };
  }
  confirm(prepared: NonNullable<ReturnType<DingTalkCards['prepare']>>, response: any): string {
    const delivery = response?.result?.deliverResults?.find((item: any) => item.spaceType === prepared.record.spaceType && item.spaceId === prepared.record.spaceId);
    if (response?.success === false || delivery?.success === false) throw new EndpointDeliveryError('platform_rejected', 'DingTalk card delivery was rejected', 'rejected');
    if (response?.success !== true || response.result?.outTrackId !== prepared.id || delivery?.success !== true) throw new EndpointDeliveryError('delivery_unconfirmed', 'DingTalk card delivery is unconfirmed', 'unknown');
    if (prepared.epoch !== this.#epoch) throw new EndpointDeliveryError('delivery_unconfirmed', 'DingTalk card completed after endpoint retirement', 'unknown');
    this.#records.set(prepared.id, prepared.record);
    for (const [id, record] of this.#records) if (record.expiresAt <= Date.now()) this.#records.delete(id);
    while (this.#records.size > 1024) this.#records.delete(this.#records.keys().next().value!);
    return prepared.id;
  }
  resolve(callback: DingTalkCardCallback) {
    const record = this.#records.get(callback.outTrackId ?? '');
    if (!record || record.expiresAt <= Date.now() || callback.spaceType !== record.spaceType || callback.spaceId !== record.spaceId || callback.userIdType !== 1 || !callback.userId || (record.corpId && callback.corpId !== record.corpId) || (record.spaceType === 'IM_ROBOT' && callback.userId !== record.staffId)) throw new Error('DingTalk card callback correlation failed');
    const content = JSON.parse(callback.content ?? '') as { cardPrivateData?: { params?: { action?: unknown } } };
    const payload = content.cardPrivateData?.params?.action;
    if (typeof payload !== 'string' || !record.payloads.has(payload)) throw new Error('DingTalk card callback payload mismatch');
    return { conversation: record.conversation, payload, sourceMessageId: callback.outTrackId!, senderId: callback.userId === record.staffId ? record.senderId ?? callback.userId : callback.userId };
  }
}
