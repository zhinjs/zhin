/**
 * QQ endpoint 配置写回：扫码成功后把 appId / appSecret 写进 `.env`，
 * 配置里只保留 `${ENV}` 引用，并按公域 / 私域展开 intents。
 *
 * 命令（`qq endpoint add`）与 Console 扫码绑定共用这一处实现。
 */
import { buildEndpointEnvKey, type EndpointConfigurationStore } from 'zhin.js/adapter';
import { defaultQqEndpointIntentFields, type QqBotKind } from './qq-intents.js';

export interface QqEndpointWriteInput {
  readonly endpointId: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly botKind: QqBotKind;
}

export interface QqEndpointWriteResult {
  readonly filePath: string;
  readonly endpointId: string;
  readonly botKind: QqBotKind;
  readonly intents: readonly string[];
}

/** 写回 `.env` + `zhin.config.yml`；失败时抛原错误，由调用方决定文案。 */
export async function writeQqEndpointWithBotKind(
  input: QqEndpointWriteInput,
  store: EndpointConfigurationStore,
): Promise<QqEndpointWriteResult> {
  const appidKey = buildEndpointEnvKey('qq', input.endpointId, 'appid');
  const secretKey = buildEndpointEnvKey('qq', input.endpointId, 'secret');
  const intentFields = defaultQqEndpointIntentFields(input.botKind);
  const { filePath } = await store.add({
    adapterKey: 'qq',
    entry: {
      id: input.endpointId,
      appid: `\${${appidKey}}`,
      secret: `\${${secretKey}}`,
      botKind: intentFields.botKind,
      intents: [...intentFields.intents],
    },
    environment: {
      [appidKey]: input.appId,
      [secretKey]: input.appSecret,
    },
  });
  return {
    filePath,
    endpointId: input.endpointId,
    botKind: intentFields.botKind,
    intents: intentFields.intents,
  };
}
