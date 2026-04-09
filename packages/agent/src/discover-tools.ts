/**
 * 文件化 Tool 发现（*.tool.md 文件扫描与构建）
 *
 * 加载顺序与 skills/agents 一致：Workspace > ~/.zhin > data > 插件包
 * 同名先发现者优先
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger, type Plugin, type ToolParametersSchema } from '@zhin.js/core';
import { getDataDir } from './discovery-utils.js';

const logger = new Logger(null, 'builtin-tools');

// ============================================================================
// 类型
// ============================================================================

export interface ToolParamShorthand {
  type: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface ToolMeta {
  name: string;
  description: string;
  /** 简写参数定义（frontmatter 格式） */
  parameters?: Record<string, ToolParamShorthand>;
  platforms?: string[];
  scopes?: string[];
  permissionLevel?: string;
  tags?: string[];
  keywords?: string[];
  kind?: string;
  hidden?: boolean;
  preExecutable?: boolean;
  /** handler 文件路径（相对于 .tool.md） */
  handler?: string;
  /** *.tool.md 文件的绝对路径 */
  filePath: string;
  /** body 内容（无 handler 时作为 prompt 模板） */
  templateBody?: string;
  /** 所属插件名（从 tools/ 目录归属推断） */
  ownerPlugin?: string;
}

// ============================================================================
// 目录收集
// ============================================================================

/**
 * 从根插件树收集：根插件与直接子插件包目录下的 `tools/`
 */
export function collectPluginToolSearchRoots(root: Plugin | null | undefined): string[] {
  if (!root) return [];
  const dirs: string[] = [];
  const push = (d: string) => { if (d && !dirs.includes(d)) dirs.push(d); };
  const fromPlugin = (p: Plugin) => {
    if (!p?.filePath) return;
    const dir = path.dirname(p.filePath);
    push(path.join(dir, 'tools'));
    const dirName = path.basename(dir);
    if (dirName === 'src' || dirName === 'lib') {
      push(path.join(path.dirname(dir), 'tools'));
    }
  };
  fromPlugin(root);
  for (const child of root.children || []) fromPlugin(child);
  return dirs;
}

/**
 * 获取所有 tool 搜索目录（标准目录 + 插件包 tools/）
 */
export function getToolSearchDirectories(root?: Plugin | null): string[] {
  const list = [
    path.join(process.cwd(), 'tools'),
    path.join(os.homedir(), '.zhin', 'tools'),
    path.join(getDataDir(), 'tools'),
  ];
  for (const d of collectPluginToolSearchRoots(root ?? undefined)) {
    if (!list.includes(d)) list.push(d);
  }
  return list;
}

// ============================================================================
// 发现
// ============================================================================

/**
 * 扫描 tools/ 目录，发现 *.tool.md 文件
 */
export async function discoverWorkspaceTools(root?: Plugin | null): Promise<ToolMeta[]> {
  const tools: ToolMeta[] = [];
  const seenNames = new Set<string>();
  const toolDirs = getToolSearchDirectories(root);

  // Build dir → pluginName mapping for attribution
  const dirToPlugin = new Map<string, string>();
  if (root) {
    const mapPlugin = (p: Plugin) => {
      if (!p?.filePath) return;
      const dir = path.dirname(p.filePath);
      dirToPlugin.set(path.join(dir, 'tools'), p.name);
      const dirName = path.basename(dir);
      if (dirName === 'src' || dirName === 'lib') {
        dirToPlugin.set(path.join(path.dirname(dir), 'tools'), p.name);
      }
    };
    mapPlugin(root);
    for (const child of root.children || []) mapPlugin(child);
  }

  for (const toolsDir of toolDirs) {
    if (!fs.existsSync(toolsDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(toolsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      let toolMdPath: string | undefined;
      if (entry.isFile() && entry.name.endsWith('.tool.md')) {
        toolMdPath = path.join(toolsDir, entry.name);
      } else if (entry.isDirectory()) {
        const nested = path.join(toolsDir, entry.name, `${entry.name}.tool.md`);
        if (fs.existsSync(nested)) toolMdPath = nested;
      }
      if (!toolMdPath) continue;

      try {
        const content = await fs.promises.readFile(toolMdPath, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) {
          logger.debug(`Tool文件 ${toolMdPath} 没有有效的frontmatter格式`);
          continue;
        }

        let jsYaml: any;
        try {
          jsYaml = await import('js-yaml');
          if (jsYaml.default) jsYaml = jsYaml.default;
        } catch (e) {
          logger.warn(`Unable to import js-yaml module: ${e}`);
          continue;
        }

        const metadata = jsYaml.load(match[1]);
        if (!metadata || !metadata.name || !metadata.description) {
          logger.debug(`Tool文件 ${toolMdPath} 缺少必需的 name/description 字段`);
          continue;
        }

        if (seenNames.has(metadata.name)) {
          logger.debug(`Tool '${metadata.name}' 已由先序目录加载，跳过: ${toolMdPath}`);
          continue;
        }
        seenNames.add(metadata.name);

        const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trim();

        tools.push({
          name: metadata.name,
          description: metadata.description,
          parameters: metadata.parameters || undefined,
          platforms: metadata.platforms,
          scopes: metadata.scopes,
          permissionLevel: metadata.permissionLevel,
          tags: metadata.tags || [],
          keywords: metadata.keywords || [],
          kind: metadata.kind,
          hidden: metadata.hidden,
          preExecutable: metadata.preExecutable,
          handler: metadata.handler,
          filePath: toolMdPath,
          templateBody: !metadata.handler && body ? body : undefined,
          ownerPlugin: dirToPlugin.get(toolsDir),
        });
        logger.debug(`Tool发现成功: ${metadata.name}`);
      } catch (e) {
        logger.warn(`Failed to parse tool.md in ${toolMdPath}:`, e);
      }
    }
  }
  return tools;
}

// ============================================================================
// 构建
// ============================================================================

function shorthandToSchema(params: Record<string, ToolParamShorthand>): ToolParametersSchema {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, param] of Object.entries(params)) {
    properties[key] = {
      type: param.type || 'string',
      description: param.description || key,
    };
    if (param.enum) properties[key].enum = param.enum;
    if (param.default !== undefined) properties[key].default = param.default;
    if (param.required) required.push(key);
  }
  return { type: 'object', properties, required: required.length > 0 ? required : undefined };
}

async function loadToolHandler(handlerPath: string, toolMdPath: string): Promise<((args: any, context?: any) => any) | undefined> {
  const resolved = path.resolve(path.dirname(toolMdPath), handlerPath);
  if (!fs.existsSync(resolved)) {
    logger.warn(`Tool handler 文件不存在: ${resolved}`);
    return undefined;
  }
  const ext = path.extname(resolved).toLowerCase();

  // Python script handler: spawn subprocess, pass args via JSON stdin, return stdout
  if (ext === '.py') {
    return async (args: any) => {
      const input = JSON.stringify(args);
      const pythonBin = process.env.PYTHON_BIN || 'python3';
      try {
        const result = await new Promise<string>((resolve, reject) => {
          const child = spawn(pythonBin, [resolved], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30_000,
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
          child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          child.on('close', (code) => {
            if (stderr) logger.debug(`[Python handler] ${resolved} stderr: ${stderr.trim()}`);
            if (code !== 0) reject(new Error(`Python exited with code ${code}: ${stderr.trim()}`));
            else resolve(stdout.trim());
          });
          child.on('error', reject);
          child.stdin.write(input);
          child.stdin.end();
        });
        return result;
      } catch (e: any) {
        return `Error running Python handler: ${e.message ?? String(e)}`;
      }
    };
  }

  // JS/TS handler: ESM import
  try {
    const fileUrl = `file://${resolved}?t=${Date.now()}`;
    const mod = await import(fileUrl);
    const fn = mod.default || mod;
    if (typeof fn !== 'function') {
      logger.warn(`Tool handler 未导出函数: ${resolved}`);
      return undefined;
    }
    return fn;
  } catch (e) {
    logger.warn(`Tool handler 加载失败 (${resolved}): ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

function buildTemplateExecute(body: string): (args: Record<string, any>) => string {
  return (args: Record<string, any>) => body.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const val = args[k];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

/**
 * 将 ToolMeta 转换为 Tool 对象（包含 execute 函数）
 */
export async function buildToolFromMeta(meta: ToolMeta): Promise<import('@zhin.js/core').Tool | null> {
  let execute: ((args: any, context?: any) => any) | undefined;

  if (meta.handler) {
    execute = await loadToolHandler(meta.handler, meta.filePath);
    if (!execute) return null;
  } else if (meta.templateBody) {
    execute = buildTemplateExecute(meta.templateBody);
  } else {
    logger.warn(`Tool '${meta.name}' 既没有 handler 也没有模板 body，跳过`);
    return null;
  }

  const parameters = meta.parameters
    ? shorthandToSchema(meta.parameters)
    : { type: 'object' as const, properties: {} };

  return {
    name: meta.name,
    description: meta.description,
    parameters,
    execute,
    tags: meta.tags,
    keywords: meta.keywords,
    platforms: meta.platforms,
    scopes: meta.scopes as any,
    permissionLevel: meta.permissionLevel as any,
    hidden: meta.hidden,
    preExecutable: meta.preExecutable,
    kind: meta.kind,
  };
}
