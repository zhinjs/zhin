/**
 * @zhin.js/devteam - GitHub API 客户端
 *
 * 封装 GitHub REST & GraphQL API，操作 Issues、Projects V2、PRs、Branches。
 *
 * 支持三种认证模式（按优先级）：
 *   1. 显式 githubToken 配置
 *   2. 委托给 GitHub 适配器的 GhClient（通过 setDelegate()）
 *   3. 自动从 gh CLI 获取 token（gh auth token）
 */

import { Logger } from 'zhin.js';
import { execFileSync } from 'node:child_process';
import type {
  DevTeamConfig,
  RequirementStatusValue,
} from './types.js';
import { STATUS_LABELS } from './types.js';

const logger = new Logger(null, 'DevTeam:GitHub');

// ============================================================================
// API 委托接口（与 @zhin.js/adapter-github 的 GhClient.request() 签名兼容）
// ============================================================================

/**
 * Duck-typed interface matching GhClient.request() from @zhin.js/adapter-github.
 * No hard dependency on the adapter package.
 */
export interface ApiDelegate {
  request<T = any>(
    method: string,
    path: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; data: T }>;
}

// ============================================================================
// gh CLI token 自动检测
// ============================================================================

/**
 * 尝试从 gh CLI 获取认证 token（需要 gh 已安装且已认证）。
 * 如果 GitHub 适配器已配置，其 gh CLI 认证同样可用于 devteam。
 */
export function resolveGhCliToken(): string | null {
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
}

// ============================================================================
// GitHub API 基础
// ============================================================================

export class GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  private projectNumber: number;
  private projectId: string | null = null;
  private statusFieldId: string | null = null;
  private statusOptions: Map<string, string> = new Map();
  private delegate: ApiDelegate | null = null;

  constructor(config: DevTeamConfig) {
    // 认证优先级: 显式 token > gh CLI 自动检测
    this.token = config.githubToken || resolveGhCliToken() || '';
    if (!config.githubToken && this.token) {
      logger.info('从 gh CLI 自动获取到 GitHub Token');
    }
    this.owner = config.owner;
    this.repo = config.repo;
    this.projectNumber = config.projectNumber;
  }

  /**
   * 设置 API 委托（通常来自 GitHub 适配器的 GhClient）。
   * 设置后 REST 和 GraphQL 调用均通过委托执行，共享适配器的认证。
   */
  setDelegate(delegate: ApiDelegate | null): void {
    this.delegate = delegate;
    if (delegate) {
      logger.info('已连接 GitHub Adapter，API 调用将通过适配器代理');
    }
  }

  /**
   * 是否有可用的认证方式（token 或 delegate）
   */
  isReady(): boolean {
    return !!(this.token || this.delegate);
  }

  // ── REST API ────────────────────────────────────────────────────────

  private async rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    // 优先使用委托（适配器的 GhClient）
    if (this.delegate) {
      const result = await this.delegate.request<T>(method, path, body);
      if (!result.ok) {
        const msg = typeof result.data === 'object' && result.data !== null
          ? JSON.stringify(result.data)
          : String(result.data);
        throw new Error(`GitHub API ${method} ${path} failed (${result.status}): ${msg}`);
      }
      return result.data;
    }

    const url = `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) return undefined as unknown as T;
    return response.json() as Promise<T>;
  }

  // ── GraphQL API ─────────────────────────────────────────────────────

  private async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    // 委托模式: gh CLI 的 `gh api /graphql` 也支持 GraphQL
    if (this.delegate) {
      const result = await this.delegate.request<{ data?: T; errors?: Array<{ message: string }> }>(
        'POST',
        '/graphql',
        { query, variables },
      );
      if (!result.ok) {
        throw new Error(`GitHub GraphQL failed (${result.status}): ${JSON.stringify(result.data)}`);
      }
      const gqlResult = result.data;
      if (gqlResult?.errors?.length) {
        throw new Error(`GitHub GraphQL: ${gqlResult.errors.map(e => e.message).join('; ')}`);
      }
      return gqlResult?.data as T;
    }

    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (result.errors?.length) {
      throw new Error(`GitHub GraphQL: ${result.errors.map(e => e.message).join('; ')}`);
    }
    return result.data as T;
  }

  // ── Project V2 初始化 ───────────────────────────────────────────────

  /**
   * 初始化 Project V2 的元数据（项目ID、状态字段ID、选项映射）
   */
  async initProject(): Promise<void> {
    if (this.projectId) return;

    // 先尝试 organization，再尝试 user（避免单次查询中一方报错导致整个失败）
    let project: ProjectV2Data | undefined;

    for (const ownerType of ['organization', 'user'] as const) {
      const query = `
        query($owner: String!, $number: Int!) {
          ${ownerType}(login: $owner) {
            projectV2(number: $number) {
              id
              fields(first: 30) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `;

      try {
        const data = await this.graphql<Record<string, { projectV2: ProjectV2Data }>>(
          query, { owner: this.owner, number: this.projectNumber },
        );
        project = data[ownerType]?.projectV2;
        if (project) break;
      } catch {
        // 当前 ownerType 不匹配，尝试下一个
      }
    }
    if (!project) {
      throw new Error(`Project #${this.projectNumber} not found for ${this.owner}`);
    }

    this.projectId = project.id;

    // 查找 Status 字段
    for (const field of project.fields.nodes) {
      if (field.name === 'Status' && field.options) {
        this.statusFieldId = field.id;
        for (const option of field.options) {
          this.statusOptions.set(option.name, option.id);
        }
        break;
      }
    }

    logger.info(`Project初始化完成: ${this.projectId}, 状态字段: ${this.statusFieldId}, 选项数: ${this.statusOptions.size}`);
  }

  // ── Issue 操作 ──────────────────────────────────────────────────────

  async createIssue(title: string, body: string, labels?: string[]): Promise<{ number: number; node_id: string }> {
    const result = await this.rest<{ number: number; node_id: string }>('POST', `/repos/${this.owner}/${this.repo}/issues`, {
      title,
      body,
      labels,
    });
    logger.info(`创建Issue: #${result.number} ${title}`);
    return result;
  }

  async getIssue(issueNumber: number): Promise<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    node_id: string;
  }> {
    return this.rest('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`);
  }

  async updateIssue(issueNumber: number, updates: { title?: string; body?: string; state?: string; labels?: string[] }): Promise<void> {
    await this.rest('PATCH', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, updates);
    logger.debug(`更新Issue: #${issueNumber}`);
  }

  async addIssueComment(issueNumber: number, body: string): Promise<{ id: number }> {
    const result = await this.rest<{ id: number }>('POST', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, { body });
    logger.debug(`添加评论到Issue #${issueNumber}`);
    return result;
  }

  async getIssueComments(issueNumber: number): Promise<Array<{ id: number; body: string; user: { login: string }; created_at: string }>> {
    return this.rest('GET', `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`);
  }

  // ── Project V2 操作 ─────────────────────────────────────────────────

  /**
   * 将 Issue 添加到 Project
   */
  async addIssueToProject(issueNodeId: string): Promise<string> {
    await this.initProject();

    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }
    `;
    const data = await this.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(mutation, { projectId: this.projectId, contentId: issueNodeId });

    return data.addProjectV2ItemById.item.id;
  }

  /**
   * 更新 Project 项目的 Status 字段
   */
  async updateProjectItemStatus(itemId: string, statusLabel: string): Promise<void> {
    await this.initProject();

    if (!this.statusFieldId) {
      throw new Error('Project 没有 Status 字段');
    }

    const optionId = this.statusOptions.get(statusLabel);
    if (!optionId) {
      throw new Error(`Status 选项 "${statusLabel}" 不存在。可用选项: ${Array.from(this.statusOptions.keys()).join(', ')}`);
    }

    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: $value
        }) {
          projectV2Item { id }
        }
      }
    `;
    await this.graphql(mutation, {
      projectId: this.projectId,
      itemId: itemId,
      fieldId: this.statusFieldId,
      value: { singleSelectOptionId: optionId },
    });

    logger.debug(`更新Project状态: ${itemId} → ${statusLabel}`);
  }

  /**
   * 获取 Project 中所有 Items 及其状态
   */
  async getProjectItems(): Promise<ProjectItem[]> {
    await this.initProject();

    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
                content {
                  ... on Issue {
                    number
                    title
                    body
                    state
                    labels(first: 10) { nodes { name } }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      node: {
        items: {
          nodes: Array<{
            id: string;
            fieldValues: {
              nodes: Array<{
                name?: string;
                field?: { name: string };
              }>;
            };
            content?: {
              number: number;
              title: string;
              body: string;
              state: string;
              labels: { nodes: Array<{ name: string }> };
            };
          }>;
        };
      };
    }>(query, { projectId: this.projectId });

    return data.node.items.nodes
      .filter(item => item.content)
      .map(item => {
        const statusField = item.fieldValues.nodes.find(fv => fv.field?.name === 'Status');
        console.log('解析Project Item:', JSON.stringify(item, null, 2));
        return {
          itemId: item.id,
          issueNumber: item.content!.number,
          title: item.content!.title,
          body: item.content!.body,
          state: item.content!.state,
          status: statusField?.name || '',
          labels: item.content!.labels.nodes.map(l => l.name),
        };
      });
  }

  // ── Branch 操作 ─────────────────────────────────────────────────────

  async createBranch(branchName: string, fromBranch: string): Promise<void> {
    const ref = await this.rest<{ object: { sha: string } }>('GET', `/repos/${this.owner}/${this.repo}/git/ref/heads/${fromBranch}`);
    await this.rest('POST', `/repos/${this.owner}/${this.repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });
    logger.info(`创建分支: ${branchName} from ${fromBranch}`);
  }

  async mergeBranch(head: string, base: string, commitMessage: string): Promise<{ sha: string }> {
    const result = await this.rest<{ sha: string }>('POST', `/repos/${this.owner}/${this.repo}/merges`, {
      base,
      head,
      commit_message: commitMessage,
    });
    logger.info(`合并分支: ${head} → ${base}`);
    return result;
  }

  // ── PR 操作 ─────────────────────────────────────────────────────────

  async createPullRequest(title: string, body: string, head: string, base: string): Promise<{ number: number; html_url: string }> {
    const result = await this.rest<{ number: number; html_url: string }>('POST', `/repos/${this.owner}/${this.repo}/pulls`, {
      title,
      body,
      head,
      base,
    });
    logger.info(`创建PR: #${result.number} ${title}`);
    return result;
  }

  async mergePullRequest(prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<void> {
    await this.rest('PUT', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`, {
      merge_method: mergeMethod,
    });
    logger.info(`合并PR: #${prNumber}`);
  }

  async getPullRequest(prNumber: number): Promise<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    head: { ref: string };
    base: { ref: string };
    mergeable: boolean | null;
  }> {
    return this.rest('GET', `/repos/${this.owner}/${this.repo}/pulls/${prNumber}`);
  }

  // ── Workflow / CI 查询 ──────────────────────────────────────────────

  async getWorkflowRuns(branchName?: string): Promise<Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
  }>> {
    const query = branchName ? `?branch=${encodeURIComponent(branchName)}&per_page=5` : '?per_page=5';
    const result = await this.rest<{
      workflow_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
      }>;
    }>('GET', `/repos/${this.owner}/${this.repo}/actions/runs${query}`);
    return result.workflow_runs;
  }

  // ── 工具方法 ────────────────────────────────────────────────────────

  /**
   * 将内部状态值映射到 Project 看板的 Status 选项名
   */
  getStatusLabel(status: RequirementStatusValue): string {
    return STATUS_LABELS[status] || status;
  }

  getOwner(): string {
    return this.owner;
  }

  getRepo(): string {
    return this.repo;
  }
}

// ── 辅助类型 ──────────────────────────────────────────────────────────

interface ProjectV2Data {
  id: string;
  fields: {
    nodes: Array<{
      id: string;
      name: string;
      options?: Array<{ id: string; name: string }>;
    }>;
  };
}

export interface ProjectItem {
  itemId: string;
  issueNumber: number;
  title: string;
  body: string;
  state: string;
  status: string;
  labels: string[];
}
