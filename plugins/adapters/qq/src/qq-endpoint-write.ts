/** A validated QR result is saved through its owning Adapter's single CAS admission. */
import type { AdapterMutationResult } from 'zhin.js/adapter';
import { defaultQqEndpointIntentFields, type QqBotKind } from './qq-intents.js';
import type { QqEndpointConfig } from './protocol.js';

export interface QqEndpointWriteInput {
  readonly endpointId: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly botKind: QqBotKind;
}
export type QqEndpointSavePort = (configuration: QqEndpointConfig) => Promise<AdapterMutationResult>;
export interface QqEndpointWriteResult {
  readonly endpointId: string;
  readonly botKind: QqBotKind;
  readonly intents: readonly string[];
  readonly mutation: AdapterMutationResult;
}
export async function writeQqEndpointWithBotKind(input: QqEndpointWriteInput, save: QqEndpointSavePort): Promise<QqEndpointWriteResult> {
  const fields = defaultQqEndpointIntentFields(input.botKind);
  const mutation = await save({ id: input.endpointId, appid: input.appId, secret: input.appSecret,
    botKind: fields.botKind, intents: [...fields.intents] });
  return { endpointId: input.endpointId, botKind: fields.botKind, intents: fields.intents, mutation };
}
