/**
 * UNI-Channel segments policy SSOT：全部 IM adapter 的 defineAdapter segments
 * 声明（outboundMedia / interactive / markdown / supported）逐平台断言，
 * 防止声明被意外改弱或删回。
 * 门禁脚本（scripts/check-*-segment-adapters.mjs）只查存在性，本测试查精确值。
 */
import { describe, expect, it } from 'vitest';
import type { AdapterDefinition } from '@zhin.js/adapter';
import defineDingTalkAdapter from '../../plugins/adapters/dingtalk/adapters/dingtalk/index.js';
import defineDiscordAdapter from '../../plugins/adapters/discord/adapters/discord/index.js';
import defineEmailAdapter from '../../plugins/adapters/email/adapters/email/index.js';
import defineGithubAdapter from '../../plugins/adapters/github/adapters/github/index.js';
import defineIcqqAdapter from '../../plugins/adapters/icqq/adapters/icqq/index.js';
import defineKookAdapter from '../../plugins/adapters/kook/adapters/kook/index.js';
import defineLarkAdapter from '../../plugins/adapters/lark/adapters/lark/index.js';
import defineLineAdapter from '../../plugins/adapters/line/adapters/line/index.js';
import defineMilkyAdapter from '../../plugins/adapters/milky/adapters/milky/index.js';
import defineNapCatAdapter from '../../plugins/adapters/napcat/adapters/napcat/index.js';
import defineOneBot11Adapter from '../../plugins/adapters/onebot11/adapters/onebot11/index.js';
import defineOneBot12Adapter from '../../plugins/adapters/onebot12/adapters/onebot12/index.js';
import defineQqAdapter from '../../plugins/adapters/qq/adapters/qq/index.js';
import defineSandboxAdapter from '../../plugins/adapters/sandbox/adapters/sandbox/index.js';
import defineSatoriAdapter from '../../plugins/adapters/satori/adapters/satori/index.js';
import defineSlackAdapter from '../../plugins/adapters/slack/adapters/slack/index.js';
import defineTelegramAdapter from '../../plugins/adapters/telegram/adapters/telegram/index.js';
import defineWechatMpAdapter from '../../plugins/adapters/wechat-mp/adapters/wechat-mp/index.js';
import defineWecomAdapter from '../../plugins/adapters/wecom/adapters/wecom/index.js';
import defineWeixinIlinkAdapter from '../../plugins/adapters/weixin-ilink/adapters/weixin-ilink/index.js';

const EXPECTED: Record<string, AdapterDefinition['segments']> = {
  dingtalk: { outboundMedia: ['url'], interactive: 'native', markdown: 'native' },
  discord: { outboundMedia: ['url', 'upload'], interactive: 'native', markdown: 'native' },
  email: { outboundMedia: ['url', 'path', 'base64'], interactive: 'text', markdown: 'native', html: 'direct' },
  github: { outboundMedia: ['url'], interactive: 'text' },
  icqq: {
    supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face', 'dice', 'rps', 'share'],
    outboundMedia: ['base64', 'url', 'path'],
    interactive: 'text',
    reaction: {
      scopes: ['group'],
      values: [
        { value: '76', label: '赞' }, { value: '66', label: '爱心' }, { value: '124', label: 'OK' },
        { value: '99', label: '鼓掌' }, { value: '144', label: '喝彩' }, { value: '320', label: '庆祝' },
        { value: '319', label: '比心' }, { value: '299', label: '牛啊' }, { value: '297', label: '拜谢' },
        { value: '182', label: '笑哭' }, { value: '179', label: 'doge' }, { value: '264', label: '捂脸' },
        { value: '271', label: '吃瓜' }, { value: '269', label: '暗中观察' }, { value: '268', label: '问号脸' },
        { value: '270', label: 'emm' }, { value: '106', label: '委屈' }, { value: '285', label: '摸鱼' },
        { value: '104', label: '哈欠' }, { value: '267', label: '头秃' }, { value: '326', label: '生气' },
      ],
    },
    model: {
      share: {
        fields: ['description', 'image', 'audio', 'platform'],
        hint: 'renders as a QQ link card. For a song, set audio to the playable link, image to the cover, description to the artist and platform to its music service (qq, netease, kugou, kuwo or migu), copied from tool results; leave a field "" when you have no real value.',
      },
    },
  },
  kook: { outboundMedia: ['url', 'upload'], interactive: 'native', markdown: 'native' },
  lark: { outboundMedia: ['url', 'upload'], interactive: 'native', markdown: 'native' },
  line: { outboundMedia: ['url'], interactive: 'text' },
  milky: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  napcat: { outboundMedia: ['url', 'base64', 'path'], interactive: 'text' },
  onebot11: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  onebot12: { outboundMedia: ['url', 'path', 'base64', 'upload'], interactive: 'text' },
  qq: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
    markdown: 'native',
    supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'markdown', 'keyboard'],
  },
  sandbox: { outboundMedia: ['url', 'base64', 'path'], interactive: 'native', html: 'direct' },
  satori: { outboundMedia: ['url', 'base64'], interactive: 'text' },
  slack: { outboundMedia: ['url', 'upload', 'path'], interactive: 'native', markdown: 'native' },
  telegram: { outboundMedia: ['url', 'upload'], interactive: 'native', markdown: 'native' },
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
