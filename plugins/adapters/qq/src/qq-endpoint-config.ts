/**
 * zhin.config.yml 中 plugins.qq.endpoints 的读写（Plugin Runtime 版）。
 * 实现已泛化到 @zhin.js/adapter 的 endpoint-commands 套件（Document 节点级保留注释）；
 * 本文件仅保留 QQ 专用签名以兼容既有调用与测试。
 */
import {
  addEndpointToConfig,
  findEndpointConfigFile,
  listConfiguredEndpoints,
  removeEndpointFromConfig,
} from '@zhin.js/adapter';

export interface QqEndpointConfigEntry {
  name: string;
  appid: string;
  secret: string;
  [key: string]: unknown;
}

/** 定位项目配置文件：ZHIN_CONFIG 指定优先，否则发现 zhin.config.yml/.yaml，都没有则默认新建 zhin.config.yml */
export function findQqConfigFile(projectRoot?: string): string {
  return findEndpointConfigFile('qq', projectRoot);
}

/** 读取 plugins.qq.endpoints（plain JS）；plugins/qq 缺失或形态不符时返回 [] */
export function listQqEndpointEntries(projectRoot?: string): QqEndpointConfigEntry[] {
  return listConfiguredEndpoints('qq', projectRoot) as QqEndpointConfigEntry[];
}

/** 追加 endpoint 到 plugins.qq.endpoints；name 已存在时报错 */
export function addQqEndpointToConfig(
  entry: QqEndpointConfigEntry,
  projectRoot?: string,
): string {
  return addEndpointToConfig('qq', entry, projectRoot);
}

/** 按 name 移除 plugins.qq.endpoints 项；不存在返回 false */
export function removeQqEndpointFromConfig(
  name: string,
  projectRoot?: string,
): { removed: boolean; filePath: string } {
  return removeEndpointFromConfig('qq', name, projectRoot);
}
