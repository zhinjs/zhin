// 重新导出 react-dom/client 的所有命名导出
import ReactDOMClient from 'react-dom/client';

// react-dom/client 的显式导出
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;

// 导出默认导出
export default ReactDOMClient.default || ReactDOMClient;
