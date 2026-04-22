module.exports = {
  apps: [
    {
      name: "opti-ai",
      cwd: "/root/sale-system",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: "1018",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      time: true,
    },
  ],
};
