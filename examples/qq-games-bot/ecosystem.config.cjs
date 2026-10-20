/** pm2 守护：在 examples/qq-games-bot 目录执行 pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'qq-games-bot',
      cwd: __dirname,
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
