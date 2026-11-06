export * from '@zhin.js/agent/runtime';
import {
  openHeadlessInferenceHost as runtimeOpenHeadlessInferenceHost,
  type HeadlessInferenceHostOptions,
} from '@zhin.js/agent/runtime';

export function openHeadlessInferenceHost(
  options: HeadlessInferenceHostOptions,
): ReturnType<typeof runtimeOpenHeadlessInferenceHost> {
  return runtimeOpenHeadlessInferenceHost(options);
}
