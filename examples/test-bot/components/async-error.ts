import { defineComponent } from '@zhin.js/component';

/**
 * Async component that rejects — verifies Runtime component error handling.
 * Used by `/test-err`.
 */
export default defineComponent({
  async render() {
    await new Promise<void>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('测试异步组件错误处理'));
      }, 50);
    });
    return '如果你看到这条消息，说明异步组件没有正确处理错误。';
  },
});
