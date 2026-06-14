/** 统一可释放资源接口 */
export interface Disposable {
  dispose(): void | Promise<void>;
}
