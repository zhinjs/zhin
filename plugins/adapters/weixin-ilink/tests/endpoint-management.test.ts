import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { listEndpointManagementCapabilities } from 'zhin.js/adapter';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import {
  WeixinContextTokenStore,
} from '../src/context-store.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import {
  resolveWeixinIlinkConfig,
  type ResolvedWeixinIlinkConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

let baseConfig: ResolvedWeixinIlinkConfig;
let dataDir: string;

function contextTokens(endpointId = baseConfig.id): WeixinContextTokenStore {
  return new WeixinContextTokenStore(new WeixinIlinkStateStore(endpointId, dataDir));
}

function gateway(): OutboundMessageService {
  return { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') };
}

function makeEndpoint(tokens = contextTokens()): WeixinIlinkEndpoint {
  return bindTestEndpoint(new WeixinIlinkEndpoint({
    id: capabilityId(rootPluginId(), adapterFeature, 'weixin-ilink'),
    gateway: gateway(),
    config: baseConfig,
    resolveCredentials: async () => ({ botToken: 'tok' }),
    contextTokens: tokens,
  }), gateway(), undefined);
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-mgmt-'));
  baseConfig = resolveWeixinIlinkConfig({
    id: 'test-ilink-mgmt',
    botToken: 'test-token',
    longPollTimeoutMs: 1000,
    dataDir,
  });
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('weixin-ilink endpoint management', () => {
  it('只暴露 listFriends（个人微信无群概念）', () => {
    const endpoint = makeEndpoint();
    expect(listEndpointManagementCapabilities(endpoint)).toEqual(['listFriends']);
    expect(endpoint.management.listGroups).toBeUndefined();
    expect(endpoint.management.listGroupMembers).toBeUndefined();
  });

  it('listFriends：从 context_token 存储推导对端，nickname 用 user_id 占位并注明来源', async () => {
    const tokens = contextTokens();
    tokens.set('wxid_alice', 'token-a');
    tokens.set('wxid_bob', 'token-b');
    const endpoint = makeEndpoint(tokens);
    const other = contextTokens('other-account');
    other.set('wxid_other', 'token-x');

    const friends = await endpoint.management.listFriends!();

    expect(friends).toEqual([
      { user_id: 'wxid_alice', nickname: 'wxid_alice', remark: 'ilink: 从会话 context_token 推导，非通讯录' },
      { user_id: 'wxid_bob', nickname: 'wxid_bob', remark: 'ilink: 从会话 context_token 推导，非通讯录' },
    ]);
    tokens.clear();
    other.clear();
  });

  it('listFriends：无会话记录时返回空列表', async () => {
    const endpoint = makeEndpoint();
    await expect(endpoint.management.listFriends!()).resolves.toEqual([]);
  });
});
