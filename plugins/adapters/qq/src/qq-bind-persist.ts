import {
  buildEndpointEnvKey,
  persistEndpointEnvValues,
  resolveProjectRoot,
} from '@zhin.js/adapter';

export { resolveProjectRoot };

export interface QqCredentialEnvKeys {
  appidKey: string;
  secretKey: string;
  appidRef: string;
  secretRef: string;
}

/** 按 endpoint 名称生成唯一 env 键（如 `QQ_MY_BOT_APPID`） */
export function buildQqCredentialEnvKeys(endpointName: string): QqCredentialEnvKeys {
  const appidKey = buildEndpointEnvKey('qq', endpointName, 'appid');
  const secretKey = buildEndpointEnvKey('qq', endpointName, 'secret');
  return {
    appidKey,
    secretKey,
    appidRef: `\${${appidKey}}`,
    secretRef: `\${${secretKey}}`,
  };
}

/** 写入或更新 `.env` 中的键值，并同步到当前进程 `process.env` */
export function persistQqCredentialsToEnv(
  endpointName: string,
  appId: string,
  appSecret: string,
  projectRoot?: string,
): QqCredentialEnvKeys {
  const keys = buildQqCredentialEnvKeys(endpointName);
  persistEndpointEnvValues(
    {
      [keys.appidKey]: appId,
      [keys.secretKey]: appSecret,
    },
    projectRoot,
  );
  return keys;
}
