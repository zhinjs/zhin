/**
 * PermissionFeature
 * 权限管理服务，继承自 Feature 抽象类
 */
import { Feature, FeatureJSON } from "@zhin.js/kernel";
import logger, { formatCompact } from "@zhin.js/logger";
import { Plugin } from "../plugin.js";
import type { MaybePromise, RegisteredAdapter, AdapterMessage } from "../types.js";
import { Message as MessageClass } from "../message.js";
import { isBuiltinPermit, parsePermitName } from "./permit-parse.js";
import { checkBuiltinPermit } from "./permit-check.js";
import { resolveSubjectRoles } from "./authorization.js";
import { senderRolesFromMessage } from "./message-enrich.js";

export type PermissionSubject = MessageClass<AdapterMessage<RegisteredAdapter>>;

export type PermissionItem<T extends RegisteredAdapter = RegisteredAdapter> = {
  name: string | RegExp;
  check: PermissionChecker<T>;
};

export type PermissionChecker<T extends RegisteredAdapter = RegisteredAdapter> = (
  name: string,
  message: MessageClass<AdapterMessage<T>>
) => MaybePromise<boolean>;

/**
 * PermissionFeature 扩展方法类型
 */
export interface PermissionContextExtensions {
  addPermission(permission: PermissionItem): () => void;
}

declare module "../plugin.js" {
  namespace Plugin {
    interface Extensions extends PermissionContextExtensions {}
    interface Contexts {
      permission: PermissionFeature;
    }
  }
}

function rolesForPermitCheck(message: MessageClass<AdapterMessage<RegisteredAdapter>>): readonly import('./roles.js').SenderRole[] {
  return senderRolesFromMessage(message);
}

function auditPermitDenied(
  permit: string,
  message: PermissionSubject,
  reason?: string,
): void {
  logger.debug(formatCompact({
    op: 'permit_denied',
    permit,
    reason,
    senderId: message.$sender.id,
    adapter: message.$adapter,
    endpoint: message.$endpoint,
  }));
}

export class PermissionFeature extends Feature<PermissionItem> {
  readonly name = 'permission' as const;
  readonly icon = 'Shield';
  readonly desc = '权限';

  constructor() {
    super();
    const builtinRe = /^(adapter|group|private|channel|user|role)\([^)]*\)$/;
    this.add(
      Permissions.define(builtinRe, (name, message) => {
        const parsed = parsePermitName(name);
        if (parsed && parsed.kind !== 'role') {
          return checkBuiltinPermit(name, message, ['user']);
        }
        return checkBuiltinPermit(name, message, rolesForPermitCheck(message));
      }),
      '__built-in__',
    );
  }

  /**
   * 检查权限（subject 为 Message 通讯上下文）
   */
  async check(name: string, subject: PermissionSubject): Promise<boolean> {
    const message = subject;

    if (isBuiltinPermit(name)) {
      const parsed = parsePermitName(name);
      if (parsed && parsed.kind !== 'role') {
        if (checkBuiltinPermit(name, message, ['user'])) return true;
      } else if (checkBuiltinPermit(name, message, rolesForPermitCheck(message))) {
        return true;
      }
    }

    for (const permission of this.items) {
      const passed = await permission.check(name, message);
      if (passed) return true;
    }

    auditPermitDenied(name, message);
    return false;
  }

  /**
   * 序列化为 JSON
   */
  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(p => ({
        name: p.name instanceof RegExp ? p.name.source : p.name,
      })),
    };
  }

  /**
   * 提供给 Plugin.prototype 的扩展方法
   */
  get extensions() {
    const feature = this;
    return {
      addPermission(permission: PermissionItem) {
        const plugin = this as Plugin;
        const dispose = feature.add(permission, plugin.name);
        const permName = permission.name instanceof RegExp ? permission.name.source : permission.name;
        plugin.recordFeatureContribution(feature.name, permName);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }
}

export namespace Permissions {
  export function define<T extends RegisteredAdapter = RegisteredAdapter>(
    name: string | RegExp,
    check: PermissionChecker<T>,
  ): PermissionItem<T> {
    return { name, check };
  }
}

/**
 * @deprecated Use PermissionFeature instead
 */
export const PermissionService = PermissionFeature;
