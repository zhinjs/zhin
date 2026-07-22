import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QqBindCallbacks } from '../src/qq-bind-flow.js';
import {
  extractQqCommandReply,
  isQqEndpointOperator,
  runQqEndpointAdd,
  runQqEndpointCancel,
  runQqEndpointList,
  runQqEndpointRemove,
} from '../src/qq-endpoint-commands.js';
import { createQqRuntimeState } from '../src/qq-runtime-state.js';

const { startQqBindFlowMock } = vi.hoisted(() => ({
  startQqBindFlowMock: vi.fn(),
}));

vi.mock('../src/qq-bind-flow.js', () => ({
  startQqBindFlow: startQqBindFlowMock,
}));

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-endpoint-cmd-'));
  startQqBindFlowMock.mockReset();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.QQ_NEWBOT_APPID;
  delete process.env.QQ_NEWBOT_SECRET;
});

function lastCallbacks(): QqBindCallbacks {
  return startQqBindFlowMock.mock.calls.at(-1)![0] as QqBindCallbacks;
}

function collectReplies(): { replies: string[]; reply: (text: string) => Promise<void> } {
  const replies: string[] = [];
  return {
    replies,
    reply: async (text: string) => {
      replies.push(text);
    },
  };
}

describe('extractQqCommandReply', () => {
  it('从消息 input 提取 $reply；非消息输入降级 no-op', async () => {
    const calls: string[] = [];
    const message = { $reply: async (content: string) => void calls.push(content) };

    const reply = extractQqCommandReply(message);
    await reply('hello');
    expect(calls).toEqual(['hello']);

    await expect(extractQqCommandReply(undefined)('x')).resolves.toBeUndefined();
    await expect(extractQqCommandReply({})('x')).resolves.toBeUndefined();
  });
});

describe('isQqEndpointOperator', () => {
  const message = (sender: string) => ({ sender });

  it('未配置 master 时放行（首个绑定者即 owner）', () => {
    expect(isQqEndpointOperator({}, message('alice'))).toBe(true);
    expect(isQqEndpointOperator({ endpoints: [{ name: 'a' }] }, message('alice'))).toBe(true);
  });

  it('顶层 master 命中放行，不命中拒绝', () => {
    const config = { master: '1659488338' };
    expect(isQqEndpointOperator(config, message('1659488338'))).toBe(true);
    expect(isQqEndpointOperator(config, message('8596238'))).toBe(false);
  });

  it('endpoints[i].master 逐项命中同样放行', () => {
    const config = { endpoints: [{ name: 'a', master: 8596238 }] };
    expect(isQqEndpointOperator(config, message('8596238'))).toBe(true);
    expect(isQqEndpointOperator(config, message('111'))).toBe(false);
  });

  it('sender 缺失时拒绝（已配置 master）', () => {
    expect(isQqEndpointOperator({ master: '1' }, {})).toBe(false);
    expect(isQqEndpointOperator({ master: '1' }, undefined)).toBe(false);
  });
});

describe('runQqEndpointAdd', () => {
  it('二维码就绪后 resolve 链接文本；成功后写 .env 与 zhin.config.yml 并回复', async () => {
    const state = createQqRuntimeState();
    const stop = vi.fn();
    startQqBindFlowMock.mockReturnValue(stop);
    const { replies, reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'newbot', reply, root);
    expect(state.bindFlow).not.toBeNull();

    lastCallbacks().onQrDisplayed?.('https://q.qq.com/connect?task_id=t1');
    const firstReply = await firstReplyPromise;
    expect(firstReply).toContain('https://q.qq.com/connect?task_id=t1');

    await lastCallbacks().onSuccess([{ appId: '102000009', appSecret: 'sec-9' }]);

    expect(state.bindFlow).toBeNull();
    // .env 凭据
    const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    expect(envContent).toContain('QQ_NEWBOT_APPID=102000009');
    expect(envContent).toContain('QQ_NEWBOT_SECRET=sec-9');
    // zhin.config.yml 追加 endpoints 项
    const configContent = fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8');
    expect(configContent).toContain('newbot');
    expect(configContent).toContain('${QQ_NEWBOT_APPID}');
    // 成功提示（经 reply 推送，因首条回复已 resolve）
    expect(replies.some((text) => text.includes('绑定成功') && text.includes('重启'))).toBe(true);
  });

  it('未指定 name 时使用 appId 作为 endpoint 名', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, undefined, reply, root);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;
    await lastCallbacks().onSuccess([{ appId: '102000010', appSecret: 's' }]);

    const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    expect(envContent).toContain('QQ_102000010_APPID=102000010');
  });

  it('已有进行中的绑定时拒绝并发', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const pending = runQqEndpointAdd(state, 'a', reply, root);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await pending;

    const second = await runQqEndpointAdd(state, 'b', reply, root);
    expect(second).toContain('已有进行中');
    expect(startQqBindFlowMock).toHaveBeenCalledTimes(1);
  });

  it('绑定失败时回复失败原因并释放单例', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { replies, reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'a', reply, root);
    lastCallbacks().onQrDisplayed?.('https://example/qr');
    await firstReplyPromise;

    lastCallbacks().onFailure(new Error('network down'));

    expect(state.bindFlow).toBeNull();
    expect(replies.some((text) => text.includes('network down'))).toBe(true);
  });

  it('二维码尚未就绪就失败时，失败原因作为首条回复', async () => {
    const state = createQqRuntimeState();
    startQqBindFlowMock.mockReturnValue(vi.fn());
    const { reply } = collectReplies();

    const firstReplyPromise = runQqEndpointAdd(state, 'a', reply, root);
    lastCallbacks().onFailure(new Error('获取绑定任务失败: boom'));

    await expect(firstReplyPromise).resolves.toContain('获取绑定任务失败');
    expect(state.bindFlow).toBeNull();
  });
});

describe('runQqEndpointCancel', () => {
  it('有进行中流程时 stop 并释放单例', () => {
    const state = createQqRuntimeState();
    const stop = vi.fn();
    state.bindFlow = { name: 'a', stop };

    expect(runQqEndpointCancel(state)).toContain('已取消');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(state.bindFlow).toBeNull();
  });

  it('无流程时提示', () => {
    const state = createQqRuntimeState();
    expect(runQqEndpointCancel(state)).toContain('没有进行中');
  });
});

describe('runQqEndpointRemove', () => {
  it('存在时从配置移除并提示重启', () => {
    fs.writeFileSync(
      path.join(root, 'zhin.config.yml'),
      'plugins:\n  qq:\n    endpoints:\n      - { name: a, appid: "1", secret: "2" }\n',
    );
    const state = createQqRuntimeState();

    const text = runQqEndpointRemove(state, 'a', root);

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8')).not.toContain('name: a');
  });

  it('不存在时提示未找到', () => {
    fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
    const state = createQqRuntimeState();

    expect(runQqEndpointRemove(state, 'ghost', root)).toContain('不存在');
  });
});

describe('runQqEndpointList', () => {
  it('同时列出运行中与配置中的 endpoints', () => {
    const state = createQqRuntimeState();
    state.endpoints.set('running-bot', { name: 'running-bot', mode: 'websocket' });
    fs.writeFileSync(
      path.join(root, 'zhin.config.yml'),
      'plugins:\n  qq:\n    endpoints:\n      - { name: conf-bot, appid: "${QQ_CONF_BOT_APPID}", secret: "${QQ_CONF_BOT_SECRET}" }\n',
    );

    const text = runQqEndpointList(state, root);

    expect(text).toContain('running-bot');
    expect(text).toContain('conf-bot');
    expect(text).toContain('${QQ_CONF_BOT_APPID}');
  });

  it('空列表时占位提示', () => {
    const state = createQqRuntimeState();
    fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');

    const text = runQqEndpointList(state, root);

    expect(text).toContain('（无）');
  });
});
