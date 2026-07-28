import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { listEndpointManagementCapabilities } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import {
  clearContextTokensForAccount,
  flushContextTokenPersist,
  setContextToken,
} from '../src/context-store.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveWeixinIlinkConfig({
  name: 'test-ilink-mgmt',
  botToken: 'test-token',
  longPollTimeoutMs: 1000,
});

function gateway(): MessageGateway {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

function makeEndpoint(): WeixinIlinkEndpoint {
  return new WeixinIlinkEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
    gateway: gateway(),
    config: baseConfig,
    resolveCredentials: async () => ({ botToken: 'tok' }),
  });
}

beforeEach(() => {
  vi.stubEnv('ZHIN_DATA_DIR', fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-mgmt-')));
});

afterEach(() => {
  clearContextTokensForAccount(baseConfig.name);
  flushContextTokenPersist();
  vi.unstubAllEnvs();
});

describe('weixin-ilink endpoint management', () => {
  it('只暴露 listFriends（个人微信无群概念）', () => {
    const endpoint = makeEndpoint();
    expect(listEndpointManagementCapabilities(endpoint)).toEqual(['listFriends']);
    expect(endpoint.management.listGroups).toBeUndefined();
    expect(endpoint.management.listGroupMembers).toBeUndefined();
  });

  it('listFriends：从 context_token 存储推导对端，nickname 用 user_id 占位并注明来源', async () => {
    setContextToken(baseConfig.name, 'wxid_alice', 'token-a');
    setContextToken(baseConfig.name, 'wxid_bob', 'token-b');
    // 其他 account 的对端不应混入
    setContextToken('other-account', 'wxid_other', 'token-x');
    const endpoint = makeEndpoint();

    const friends = await endpoint.management.listFriends!();

    expect(friends).toEqual([
      { user_id: 'wxid_alice', nickname: 'wxid_alice', remark: 'ilink: 从会话 context_token 推导，非通讯录' },
      { user_id: 'wxid_bob', nickname: 'wxid_bob', remark: 'ilink: 从会话 context_token 推导，非通讯录' },
    ]);
    clearContextTokensForAccount('other-account');
  });

  it('listFriends：无会话记录时返回空列表', async () => {
    const endpoint = makeEndpoint();
    await expect(endpoint.management.listFriends!()).resolves.toEqual([]);
  });
});
