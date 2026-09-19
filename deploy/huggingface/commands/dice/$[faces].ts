import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '掷骰子',
  params:{
    faces: {
      type: 'number',
      description: '骰子面数',
      default: 6,
    },
  },
  execute: ({ params }) => {
    const faces = Number(params.faces);
    if (!Number.isFinite(faces) || faces < 2) {
      return '用法: /dice [faces]  例: /dice 6';
    }
    const roll = Math.floor(Math.random() * faces) + 1;
    return `掷出了 ${roll}（${faces} 面骰）`;
  },
});
