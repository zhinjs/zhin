import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  fileUploadFailed: { 'zh-CN': '文件上传失败，未返回文件标识', en: 'File upload failed; no file key was returned.' },
  "createFailed": {
    "zh-CN": "创建失败",
    "en": "Creation failed"
  },
  "chatCreated": {
    "zh-CN": "群聊创建成功: {p0}",
    "en": "Group chat created: {p0}"
  },
  "fileUploaded": {
    "zh-CN": "文件已上传，file_key: {p0}",
    "en": "File uploaded, file_key: {p0}"
  },
  "addFailed": {
    "zh-CN": "添加失败",
    "en": "Could not add members"
  },
  "membersAdded": {
    "zh-CN": "成员添加成功",
    "en": "Members added"
  },
  "dissolveFailed": {
    "zh-CN": "解散失败",
    "en": "Could not dissolve the group chat"
  },
  "chatDissolved": {
    "zh-CN": "群聊已解散",
    "en": "Group chat dissolved"
  },
  "removeFailed": {
    "zh-CN": "移除失败",
    "en": "Removal failed"
  },
  "managersRemoved": {
    "zh-CN": "管理员移除成功",
    "en": "Administrators removed"
  },
  "setFailed": {
    "zh-CN": "设置失败",
    "en": "Update failed"
  },
  "managersSet": {
    "zh-CN": "管理员设置成功",
    "en": "Administrators set"
  },
  "updateFailed": {
    "zh-CN": "更新失败",
    "en": "Update failed"
  },
  "chatInfoUpdated": {
    "zh-CN": "群信息更新成功",
    "en": "Group information updated"
  }
});
