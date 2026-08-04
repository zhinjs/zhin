/**
 * UNI-Channel segments policy SSOT：全部 IM adapter 的 defineAdapter segments
 * 声明（outboundMedia / interactive）逐平台断言，防止声明被意外改弱或删回。
 * 门禁脚本（scripts/check-*-segment-adapters.mjs）只查存在性，本测试查精确值。
 */
import { describe, expect, it } from 'vitest';
import type { AdapterDefinition } from '@zhin.js/adapter';
import defineDingTalkAdapter from '../../plugins/adapters/dingtalk/adapters/dingtalk.js';
import defineDiscordAdapter from '../../plugins/adapters/discord/adapters/discord.js';
import defineEmailAdapter from '../../plugins/adapters/email/adapters/email.js';
import defineGithubAdapter from '../../plugins/adapters/github/adapters/github.js';
import defineIcqqAdapter from '../../plugins/adapters/icqq/adapters/icqq.js';
import defineKookAdapter from '../../plugins/adapters/kook/adapters/kook.js';
import defineLarkAdapter from '../../plugins/adapters/lark/adapters/lark.js';
import defineLineAdapter from '../../plugins/adapters/line/adapters/line.js';
import defineMilkyAdapter from '../../plugins/adapters/milky/adapters/milky.js';
import defineNapCatAdapter from '../../plugins/adapters/napcat/adapters/napcat.js';
import defineOneBot11Adapter from '../../plugins/adapters/onebot11/adapters/onebot11.js';
import defineOneBot12Adapter from '../../plugins/adapters/onebot12/adapters/onebot12.js';
import defineQqAdapter from '../../plugins/adapters/qq/adapters/qq.js';
import defineSandboxAdapter from '../../plugins/adapters/sandbox/adapters/sandbox.js';
import defineSatoriAdapter from '../../plugins/adapters/satori/adapters/satori.js';
import defineSlackAdapter from '../../plugins/adapters/slack/adapters/slack.js';
import defineTelegramAdapter from '../../plugins/adapters/telegram/adapters/telegram.js';
import defineWechatMpAdapter from '../../plugins/adapters/wechat-mp/adapters/wechat-mp.js';
import defineWecomAdapter from '../../plugins/adapters/wecom/adapters/wecom.js';
import defineWeixinIlinkAdapter from '../../plugins/adapters/weixin-ilink/adapters/weixin-ilink.js';

const EXPECTED: Record<string, AdapterDefinition['segments']> = {
  dingtalk: { outboundMedia: ['url'], interactive: 'text' },
  discord: { outboundMedia: ['url', 'upload'], interactive: 'native' },
  email: { outboundMedia: ['url', 'path', 'base64'], interactive: 'text' },
  github: { outboundMedia: ['url'], interactive: 'text' },
  icqq: { outboundMedia: ['base64', 'url', 'path'], interactive: 'text' },
  kook: { outboundMedia: ['url'], interactive: 'text' },
  lark: { outboundMedia: ['url', 'upload'], interactive: 'text' },
  line: { outboundMedia: ['url'], interactive: 'text' },
  milky: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  napcat: { outboundMedia: ['url', 'base64', 'path'], interactive: 'text' },
  onebot11: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  onebot12: { outboundMedia: ['url', 'path', 'base64', 'upload'], interactive: 'text' },
  qq: { outboundMedia: ['url', 'upload'], interactive: 'native' },
  sandbox: { outboundMedia: ['url', 'base64', 'path'], interactive: 'native' },
  satori: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  slack: { outboundMedia: ['url', 'upload', 'path'], interactive: 'native' },
  telegram: { outboundMedia: ['url', 'upload'], interactive: 'native' },
  'wechat-mp': { outboundMedia: ['upload'], interactive: 'text' },
  wecom: { outboundMedia: ['upload'], interactive: 'text' },
  'weixin-ilink': { outboundMedia: ['upload'], interactive: 'text' },
};

const ADAPTERS: Record<string, AdapterDefinition> = {
  dingtalk: defineDingTalkAdapter,
  discord: defineDiscordAdapter,
  email: defineEmailAdapter,
  github: defineGithubAdapter,
  icqq: defineIcqqAdapter,
  kook: defineKookAdapter,
  lark: defineLarkAdapter,
  line: defineLineAdapter,
  milky: defineMilkyAdapter,
  napcat: defineNapCatAdapter,
  onebot11: defineOneBot11Adapter,
  onebot12: defineOneBot12Adapter,
  qq: defineQqAdapter,
  sandbox: defineSandboxAdapter,
  satori: defineSatoriAdapter,
  slack: defineSlackAdapter,
  telegram: defineTelegramAdapter,
  'wechat-mp': defineWechatMpAdapter,
  wecom: defineWecomAdapter,
  'weixin-ilink': defineWeixinIlinkAdapter,
};

describe('UNI-Channel segments policy（全平台声明 SSOT）', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} 声明 ${JSON.stringify(expected)}`, () => {
      expect(ADAPTERS[name]?.segments).toEqual(expected);
    });
  }

  it('覆盖全部 adapter（EXPECTED 与 ADAPTERS 键集一致）', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});
