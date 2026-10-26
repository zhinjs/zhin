import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "status": {
    "zh-CN": "复读机状态\n监控群数: {groups}\n触发阈值: {threshold} 人\n冷却时间: {cooldown}s\n消息长度上限: {length}\n累计复读: {repeats} 次",
    "en": "Repeater status\nMonitored groups: {groups}\nTrigger threshold: {threshold} users\nCooldown: {cooldown}s\nMaximum message length: {length}\nTotal repetitions: {repeats}"
  }
});
