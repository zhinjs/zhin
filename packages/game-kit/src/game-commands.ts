/** 展示用：`/猜拳` */
export function slashCommandPrefix(name: string): string {
  return name.startsWith('/') ? name : `/${name}`;
}
