import * as path from 'node:path';
import { getLogger } from '@zhin.js/logger';
import type { AgentPromptSectionConfig } from './define-agent-prompt-section.js';
import type { PromptAssemblyRegistry } from './prompt-assembly-registry.js';

const logger = getLogger('PromptSectionLoader');

export interface PromptSectionLoaderOptions {
  /**
   * 相对于插件根目录的 glob 模式
   * @default 'agent/prompt-sections'
   */
  subdir?: string;

  /**
   * 是否在发现失败时抛出错误
   * @default false
   */
  strict?: boolean;
}

function isValidPromptSection(obj: unknown): obj is AgentPromptSectionConfig {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['title'] === 'string' &&
    typeof s['content'] === 'string'
  );
}

export class PromptSectionLoader {
  /**
   * 从指定目录路径加载所有提示词节点文件。
   *
   * @param dirPath 绝对路径，对应 `agent/prompt-sections/` 目录
   */
  async loadFromDir(
    dirPath: string,
    options?: Pick<PromptSectionLoaderOptions, 'strict'>,
  ): Promise<AgentPromptSectionConfig[]> {
    const { default: fs } = await import('node:fs');
    const sections: AgentPromptSectionConfig[] = [];

    let files: string[];
    try {
      // Node recursive readdir may be typed as Dirent[] depending on overloads; normalize to relative paths.
      const entries = fs.readdirSync(dirPath, { recursive: true }) as Array<
        string | { name: string; parentPath?: string; path?: string }
      >;
      files = entries
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          const parent = entry.parentPath ?? entry.path;
          return parent ? path.relative(dirPath, path.join(parent, entry.name)) : entry.name;
        })
        .filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    } catch {
      // 目录不存在时静默忽略
      return sections;
    }

    for (const rel of files) {
      const filePath = path.join(dirPath, rel);
      try {
        const mod = await import(filePath);
        const section: unknown = mod.default;
        if (isValidPromptSection(section)) {
          sections.push(section);
        } else {
          logger.warn(`[PromptSectionLoader] ${filePath} default export is not a valid AgentPromptSectionConfig — skipped`);
        }
      } catch (err) {
        if (options?.strict) throw err;
        logger.warn(`[PromptSectionLoader] failed to load ${filePath}: ${(err as Error).message}`);
      }
    }

    return sections;
  }

  /**
   * 将提示词节点列表批量注册到 registry。
   */
  async registerToRegistry(
    sections: AgentPromptSectionConfig[],
    registry: PromptAssemblyRegistry,
  ): Promise<void> {
    for (const section of sections) {
      registry.register(section.id, {
        layer: (section.layer as any) ?? 'context',
        title: section.title,
        content: section.content,
        priority: section.priority ?? 50,
        truncatable: section.truncatable ?? true,
        maxChars: section.maxChars,
        metadata: section.metadata,
      });
    }
  }
}
