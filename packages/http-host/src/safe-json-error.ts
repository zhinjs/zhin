/** 对外 JSON 错误体（不暴露堆栈或内部路径） */
export const INTERNAL_ERROR_JSON = JSON.stringify({
  success: false,
  error: 'Internal Server Error',
});
