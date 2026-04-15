// 重新导出 ReactDOM 的所有命名导出
import ReactDOM from 'react-dom';
// react-dom 的显式导出
export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
export const createPortal = ReactDOM.createPortal;
export const flushSync = ReactDOM.flushSync;
export const preconnect = ReactDOM.preconnect;
export const prefetchDNS = ReactDOM.prefetchDNS;
export const preinit = ReactDOM.preinit;
export const preinitModule = ReactDOM.preinitModule;
export const preload = ReactDOM.preload;
export const preloadModule = ReactDOM.preloadModule;
export const requestFormReset = ReactDOM.requestFormReset;
export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;
export const useFormState = ReactDOM.useFormState;
export const useFormStatus = ReactDOM.useFormStatus;
export const version = ReactDOM.version;


// 导出默认导出 - 使用 default 属性如果存在，否则使用原始对象
export default ReactDOM.default || ReactDOM;
