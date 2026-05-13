/**
 * AI 内置系统工具
 *
 * 文件工具:  read_file / write_file / edit_file / list_dir / glob / grep（builtin/* + BuiltinBaseTool）
 * Shell:     bash（builtin/bash-tool）
 * 网络:      web_search, web_fetch（builtin/web-*-tool）
 * 计划:      todo_read, todo_write（builtin/todo-*-tool）
 * 记忆:      read_memory, write_memory（builtin/read-memory-tool, write-memory-tool）
 * 技能:      activate_skill, install_skill（builtin/activate-skill-tool, install-skill-tool）
 * 交互:      ask_user（builtin/ask-user-tool）
 *
 * 发现逻辑已拆分到 discovery/skills.ts、agents.ts、tools.ts
 */

import type { Plugin, ToolInput } from '@zhin.js/core';
import { getDataDir, mergeSkillDirsWithResolver } from './discovery/utils.js';
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
import { createReadMemoryTool } from './builtin/read-memory-tool.js';
import { createWriteMemoryTool } from './builtin/write-memory-tool.js';
import { createActivateSkillTool } from './builtin/activate-skill-tool.js';
import { createInstallSkillTool } from './builtin/install-skill-tool.js';
import { createAskUserTool } from './builtin/ask-user-tool.js';

export interface BuiltinToolsOptions {
  /** 插件实例，用于 ask_user 工具创建 Prompt 交互 */
  plugin: Plugin;
  /** Max chars for skill instruction extraction (model-size-aware) */
  skillInstructionMaxChars?: number;
  /**
   * 返回额外技能根目录（每个根下为 `<skillName>/SKILL.md`），通常为已加载插件的 `.../skills`
   */
  pluginSkillRootsResolver?: () => string[];
  /**
   * 按名称查找 SkillFeature 中已注册技能的 filePath
   * 返回 SKILL.md 的绝对路径，或 undefined 表示未找到
   */
  skillFileLookup?: (name: string) => string | undefined;
}

/**
 * 创建所有内置系统工具
 */
export function createBuiltinTools(options: BuiltinToolsOptions): ToolInput[] {
  const DATA_DIR = getDataDir();
  const skillMaxChars = options?.skillInstructionMaxChars ?? 4000;
  const skillDirList = () => mergeSkillDirsWithResolver(options?.pluginSkillRootsResolver);
  const skillFileLookup = options?.skillFileLookup;
  const pluginRef = options?.plugin;

  const tools: ToolInput[] = [];

  tools.push(createReadFileTool());
  tools.push(createWriteFileTool());
  tools.push(createEditFileTool());
  tools.push(createListDirTool());
  tools.push(createGlobTool());
  tools.push(createGrepTool());
  tools.push(createBashTool());
  tools.push(createWebSearchTool());
  tools.push(createWebFetchTool());
  tools.push(createTodoReadTool(DATA_DIR));
  tools.push(createTodoWriteTool(DATA_DIR));

  tools.push(createReadMemoryTool(DATA_DIR));
  tools.push(createWriteMemoryTool(DATA_DIR));

  tools.push(
    createActivateSkillTool({
      skillFileLookup,
      skillDirList,
      skillMaxChars,
    }),
  );
  tools.push(createInstallSkillTool());

  tools.push(createAskUserTool(pluginRef));

  return tools;
}
