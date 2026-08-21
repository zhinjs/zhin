/**
 * AI 内置系统工具
 *
 * 文件工具:  read_file / write_file / edit_file / list_dir / glob / grep（builtin/* + BuiltinBaseTool）
 * Shell:     bash（builtin/bash-tool）
 * 网络:      web_search, web_fetch（builtin/web-*-tool）
 * 计划:      todo_read, todo_write（builtin/todo-*-tool）
 * 外部 MCP 工具由 generation MCPFeature 投影按 active binding 注入。
 * 技能:      load_skill, install_skill（builtin/load-skill-tool, install-skill-tool）
 * 交互工具由 Plugin Runtime 以 turn-scoped ToolFeature 发布。
 *
 * 发现逻辑已拆分到 discovery/skills.ts、agents.ts、tools.ts
 */

import type { Plugin, ToolInput } from '@zhin.js/core';
import { getDataDir } from './discovery/utils.js';
import { createReadFileTool } from './builtin/read-file-tool.js';
import { createWriteFileTool } from './builtin/write-file-tool.js';
import { createEditFileTool } from './builtin/edit-file-tool.js';
import { createListDirTool } from './builtin/list-dir-tool.js';
import { createGlobTool } from './builtin/glob-tool.js';
import { createGrepTool } from './builtin/grep-tool.js';
import { createBashTool } from './builtin/bash-tool.js';
import { createWebSearchTool } from './builtin/web-search-tool.js';
import { createWebFetchTool } from './builtin/web-fetch-tool.js';
import { createTodoReadTool } from './builtin/todo-read-tool.js';
import { createTodoWriteTool } from './builtin/todo-write-tool.js';
import { createInstallSkillTool } from './builtin/install-skill-tool.js';
import { createAnalyzeMediaTool } from './builtin/analyze-media-tool.js';
import { createKnowledgeSearchTool } from './builtin/knowledge-search-tool.js';

export interface BuiltinToolsOptions {
  /** Classic Plugin authority still required by the legacy bash definition. */
  plugin: Plugin;
  /** 知识库目录（注册 knowledge_search 工具） */
  knowledgeDir?: string;
}

/**
 * 创建所有内置系统工具
 */
export function createBuiltinTools(options: BuiltinToolsOptions): ToolInput[] {
  const DATA_DIR = getDataDir();
  const pluginRef = options?.plugin;

  const tools: ToolInput[] = [];

  tools.push(createReadFileTool());
  tools.push(createAnalyzeMediaTool());
  tools.push(createWriteFileTool());
  tools.push(createEditFileTool());
  tools.push(createListDirTool());
  tools.push(createGlobTool());
  tools.push(createGrepTool());
  tools.push(createBashTool(pluginRef.root ?? pluginRef));
  tools.push(createWebSearchTool());
  tools.push(createWebFetchTool());
  tools.push(createTodoReadTool(DATA_DIR));
  tools.push(createTodoWriteTool(DATA_DIR));

  tools.push(createInstallSkillTool());

  if (options?.knowledgeDir) {
    tools.push(createKnowledgeSearchTool({ knowledgeDir: options.knowledgeDir }));
  }

  return tools;
}
