/**
 * @zhin.js/devteam - GitHub API 客户端
 *
 * 封装 GitHub REST & GraphQL API，操作 Issues、Projects V2、PRs、Branches
 */

import { Logger } from 'zhin.js';
import type {
  DevTeamConfig,
  RequirementStatusValue,
} from './types.js';
import { STATUS_LABELS } from './types.js';

const logger = new Logger(null, 'DevTeam:GitHub');

// ============================================================================
// GitHub API 基础
// ============================================================================

interface GitHubRequestOptions {
  method?: string;
  path?: string;
  body?: unknown;
  graphql?: string;
  variables?: Record<string, unknown>;
}

export class GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  private projectNumber: number;
  private projectId: string | null = null;
  private statusFieldId: string | null = null;
  private statusOptions: Map<string, string> = new Map();

  constructor(config: DevTeamConfig) {
    this.token = config.githubToken;
    this.owner = config.owner;
    this.repo = config.repo;
    this.projectNumber = config.projectNumber;
  }

  // ── REST API ────────────────────────────────────────────────────────

  private async rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
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

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // ── GraphQL API ─────────────────────────────────────────────────────

  private async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
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

    const query = `
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
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
        organization(login: $owner) {
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

    const data = await this.graphql<{
      user?: { projectV2: ProjectV2Data };
      organization?: { projectV2: ProjectV2Data };
    }>(query, { owner: this.owner, number: this.projectNumber });

    const project = data.user?.projectV2 || data.organization?.projectV2;
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
