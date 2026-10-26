import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "requestFailed": {
    "zh-CN": "二维码识别服务请求失败",
    "en": "The QR code service request failed."
  },
  "notFound": {
    "zh-CN": "未能识别二维码内容{detail}",
    "en": "Could not read a QR code{detail}"
  },
  "result": {
    "zh-CN": "识别结果：{text}",
    "en": "QR code content: {text}"
  },
  "failed": {
    "zh-CN": "二维码识别失败，请检查图片链接是否有效",
    "en": "Could not read the QR code. Check the image URL."
  }
});
