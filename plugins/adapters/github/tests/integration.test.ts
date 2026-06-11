/**
 * GitHub 适配器集成测试
 *
 * 策略：Mock 掉 GitHub API 客户端，测试 Endpoint 接口合规性、
 * 消息格式化、发送/接收链路、生命周期的完整性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Plugin, type SendOptions } from 'zhin.js';
import { createAdapterTestSuite } from '../../../../packages/im/core/tests/adapter-harness.js';
import { GitHubAdapter } from '../src/adapter.js';
import { GitHubEndpoint } from '../src/endpoint.js';
import type { GitHubEndpointConfig, IssueCommentPayload } from '../src/types.js';

const FIXED_TS = 1700000000000;

// ── Mock Endpoint ──

class MockGitHubEndpoint extends GitHubEndpoint {
  sendMock = vi.fn();

  constructor(adapter: GitHubAdapter, config: GitHubEndpointConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.sendMock(options);
    return `gh-comment-${Date.now()}`;
  }

  async $recallMessage(_id: string): Promise<void> {
    // GitHub 撤回需要 repo 信息
  }
}

// ── Mock Adapter ──

class MockGitHubAdapter extends GitHubAdapter {
  createEndpoint(config: GitHubEndpointConfig): MockGitHubEndpoint {
    return new MockGitHubEndpoint(this, {
      context: 'github',
      name: config.name || 'test-endpoint',
      ...config,
    });
  }
}

// ── 原始消息工厂 ──

function createGitHubRawEvent(overrides: Partial<IssueCommentPayload> = {}): IssueCommentPayload {
  return {
    action: 'created',
    comment: {
      id: 12345,
      body: '你好世界',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      user: { login: 'test-user', id: 1, avatar_url: '', html_url: '' },
      html_url: 'https://github.com/owner/repo/issues/1#issuecomment-12345',
    },
    issue: {
      number: 42,
      title: 'Test Issue',
      state: 'open',
      user: { login: 'issue-author', id: 2, avatar_url: '', html_url: '' },
      html_url: 'https://github.com/owner/repo/issues/42',
      labels: [],
    },
    repository: {
      full_name: 'owner/repo',
      name: 'repo',
      owner: { login: 'owner', id: 3 },
      html_url: 'https://github.com/owner/repo',
      private: false,
    },
    sender: {
      login: 'test-user',
      id: 1,
      avatar_url: '',
      html_url: '',
    },
    ...overrides,
  } as any;
}

// ── Harness 标准测试套件（接口合规、生命周期、消息链路、错误处理）──

createAdapterTestSuite<MockGitHubAdapter, IssueCommentPayload>({
  adapterName: 'github',
  endpointId: 'test-endpoint',
  createAdapter: (plugin) => {
    const adapter = new MockGitHubAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'github' }];
    return adapter;
  },
  createRawEvent: () => createGitHubRawEvent(),
  skip: { reply: true },
});

// ============================================================================

describe('GitHub 适配器特定测试', () => {
  let plugin: Plugin;
  let adapter: MockGitHubAdapter;
  let endpoint: MockGitHubEndpoint;

  beforeEach(async () => {
    plugin = new Plugin('/test/github-integration.ts');
    adapter = new MockGitHubAdapter(plugin);
    (adapter as any).config = [{ name: 'test-endpoint', context: 'github' }];
    await adapter.start();
    endpoint = adapter.endpoints.get('test-endpoint') as MockGitHubEndpoint;
  });

  afterEach(async () => {
    try { await adapter.stop(); } catch { /* ignore */ }
  });

  describe('Endpoint 接口合规性', () => {
    it('$id 应为配置的 name', () => {
      expect(endpoint.$id).toBe('test-endpoint');
    });

    it('$connected 启动后应为 true', () => {
      expect(endpoint.$connected).toBe(true);
    });

    it('应实现所有 Endpoint 接口方法', () => {
      expect(typeof endpoint.$formatMessage).toBe('function');
      expect(typeof endpoint.$connect).toBe('function');
      expect(typeof endpoint.$disconnect).toBe('function');
      expect(typeof endpoint.$sendMessage).toBe('function');
      expect(typeof endpoint.$recallMessage).toBe('function');
    });
  });

  describe('生命周期', () => {
    it('start() 应注册 endpoint', () => {
      expect(adapter.endpoints.has('test-endpoint')).toBe(true);
    });

    it('stop() 应清空 endpoints', async () => {
      await adapter.stop();
      expect(adapter.endpoints.size).toBe(0);
    });

    it('stop() 后 endpoint 应 disconnected', async () => {
      await adapter.stop();
      expect(endpoint.$connected).toBe(false);
    });
  });

  describe('$formatMessage 消息格式化', () => {
    it('Issue 评论应正确格式化', () => {
      const raw = createGitHubRawEvent();
      const msg = endpoint.$formatMessage(raw);

      expect(msg.$id).toBe('12345');
      expect(msg.$adapter).toBe('github');
      expect(msg.$endpoint).toBe('test-endpoint');
      expect(msg.$sender.id).toBe('test-user');
      expect(msg.$channel.type).toBe('group');
      expect(msg.$raw).toBe('你好世界');
      expect(typeof msg.$reply).toBe('function');
      expect(typeof msg.$recall).toBe('function');
    });

    it('$timestamp 应为正整数', () => {
      const raw = createGitHubRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$timestamp).toBeGreaterThan(0);
    });

    it('channel ID 应包含 repo 和 issue 号', () => {
      const raw = createGitHubRawEvent();
      const msg = endpoint.$formatMessage(raw);
      expect(msg.$channel.id).toContain('owner/repo');
    });
  });

  describe('消息发送', () => {
    it('sendMessage 应返回字符串 ID', async () => {
      const result = await adapter.sendMessage({
        context: 'github',
        endpoint: 'test-endpoint',
        id: 'owner/repo/issue/42',
        type: 'group',
        content: [{ type: 'text', data: { text: 'comment' } }],
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('消息接收链路', () => {
    it('emit message.receive 应触发 plugin.dispatch', async () => {
      const dispatchSpy = vi.spyOn(plugin, 'dispatch');
      const raw = createGitHubRawEvent();
      const msg = endpoint.$formatMessage(raw);

      adapter.emit('message.receive', msg);
      await new Promise(r => setTimeout(r, 50));

      expect(dispatchSpy).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'github' }),
      );
    });
  });

  describe('$reply 路由', () => {
    it('$reply 应调用 gh.createIssueComment 创建评论', async () => {
      // GitHub endpoint 的 $reply 直接调用 gh.createIssueComment，不走 adapter.sendMessage
      const mockCreateIssueComment = vi.fn().mockResolvedValue({ ok: true, data: { id: 99999 } });
      (endpoint as any).gh = { createIssueComment: mockCreateIssueComment, deleteIssueComment: vi.fn() };

      const raw = createGitHubRawEvent();
      const msg = endpoint.$formatMessage(raw);

      const result = await msg.$reply('回复内容');
      expect(mockCreateIssueComment).toHaveBeenCalledTimes(1);
      expect(mockCreateIssueComment).toHaveBeenCalledWith('owner/repo', 42, '回复内容');
      expect(result).toBe('99999');
    });
  });
});
