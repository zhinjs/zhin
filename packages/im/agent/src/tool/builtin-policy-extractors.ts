/**
 * Builtin 工具的策略输入提取器注册。
 *
 * 每个 builtin 声明如何从工具参数派生 ToolPolicyInput，
 * 供 ToolRuntime 在执行前统一调用 runToolPolicies。
 *
 * 注意：web_fetch 和 web_search 有 per-URL 的二次策略检查，
 * 这些通过 ToolRuntime.checkPolicy() 在工具内部调用。
 */
import { expandHome } from '../discovery/utils.js';
import type { ToolPolicyInput } from '../security/policy-facade.js';
import type { ToolPolicyInputExtractor, ToolPolicyInputResolver } from './tool-runtime.js';

const fileReadExtractor: ToolPolicyInputExtractor = (toolName, args, commMessage) => {
  const filePathArg = String(args.file_path || args.path || '');
  const fp = filePathArg ? expandHome(filePathArg) : undefined;
  return {
    toolName,
    filePath: fp,
    rawFilePath: filePathArg || undefined,
    fileOperation: 'read' as const,
    devicePathGuard: true,
    commMessage,
  };
};

const fileWriteExtractor = (op: 'create' | 'update'): ToolPolicyInputExtractor =>
  (toolName, args, commMessage) => {
    const filePathArg = String(args.file_path || args.path || '');
    const fp = filePathArg ? expandHome(filePathArg) : undefined;
    return {
      toolName,
      filePath: fp,
      rawFilePath: filePathArg || undefined,
      fileOperation: op,
      commMessage,
    };
  };

const dirExtractor: ToolPolicyInputExtractor = (toolName, args, commMessage) => {
  const dirPath = String(args.path || args.directory || args.cwd || process.cwd());
  return { toolName, filePath: dirPath, commMessage };
};

const bashExtractor: ToolPolicyInputExtractor = (toolName, args, commMessage) => ({
  toolName: 'bash',
  command: String(args.command || ''),
  commMessage,
});

const webFetchExtractor: ToolPolicyInputExtractor = (toolName, _args, commMessage) => ({
  toolName: 'web_fetch',
  commMessage,
});

const webSearchExtractor: ToolPolicyInputExtractor = (toolName, _args, commMessage) => ({
  toolName: 'web_search',
  commMessage,
});

const BUILTIN_POLICY_EXTRACTORS: Readonly<Record<string, ToolPolicyInputExtractor>> = Object.freeze({
  read_file: fileReadExtractor,
  write_file: fileWriteExtractor('create'),
  edit_file: fileWriteExtractor('update'),
  glob: dirExtractor,
  grep: dirExtractor,
  list_dir: dirExtractor,
  bash: bashExtractor,
  web_fetch: webFetchExtractor,
  web_search: webSearchExtractor,
});

export const resolveBuiltinToolPolicyInput: ToolPolicyInputResolver =
  (toolName, args, commMessage) => {
    const extractor = BUILTIN_POLICY_EXTRACTORS[toolName];
    return extractor
      ? extractor(toolName, args, commMessage)
      : { toolName, commMessage };
  };
