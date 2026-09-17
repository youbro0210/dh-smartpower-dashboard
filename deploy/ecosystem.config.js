module.exports = {
  apps: [
    {
      name: "dh-dashboard",
      script: "npm",
      args: "start",
      cwd: "/var/www/dh-smartpower-dashboard",
      instances: 1,
      autorestart: true,
      // SSE 연결이 장시간 유지되므로 메모리 재시작 기준을 넉넉히 둡니다.
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "/var/log/dh-dashboard/error.log",
      out_file: "/var/log/dh-dashboard/out.log",
      time: true,
    },
  ],
};
