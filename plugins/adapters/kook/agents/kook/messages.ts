import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "unknownAction": {
    "zh-CN": "未知操作: {p0}",
    "en": "Unknown action: {p0}"
  },
  "operationFailed": {
    "zh-CN": "操作失败",
    "en": "Operation failed"
  },
  "unblacklisted": {
    "zh-CN": "已将 {p0} 从黑名单移除",
    "en": "Removed {p0} from the blacklist"
  },
  "blacklisted": {
    "zh-CN": "已将 {p0} 加入黑名单",
    "en": "Added {p0} to the blacklist"
  },
  "roleCreated": {
    "zh-CN": "已创建角色 \"{p0}\"",
    "en": "Role \"{p0}\" created"
  },
  "roleDeleteFailed": {
    "zh-CN": "删除角色失败",
    "en": "Could not delete the role"
  },
  "roleDeleted": {
    "zh-CN": "已删除角色 {p0}",
    "en": "Role {p0} deleted"
  },
  "roleGrantFailed": {
    "zh-CN": "授予角色失败",
    "en": "Could not grant the role"
  },
  "roleGranted": {
    "zh-CN": "已授予用户 {p0} 角色 {p1}",
    "en": "Granted role {p1} to user {p0}"
  },
  "roleRevokeFailed": {
    "zh-CN": "撤销角色失败",
    "en": "Could not revoke the role"
  },
  "roleRevoked": {
    "zh-CN": "已撤销用户 {p0} 的角色 {p1}",
    "en": "Revoked role {p1} from user {p0}"
  }
});
